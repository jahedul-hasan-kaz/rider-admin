-- M3 · Promotions (budget reservation), ratings, support tickets, safety incidents and SOS
-- (docs/spec/04 §8, §12, §13). Writes only through SECURITY DEFINER functions.

create type public.ticket_status as enum ('open', 'in_progress', 'pending_user', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.incident_severity as enum ('low', 'medium', 'high', 'critical');
create type public.incident_status as enum ('reported', 'acknowledged', 'investigating', 'escalated', 'resolved', 'closed');

insert into public.app_settings (key, value, description) values
  ('ratings.window_days', '7', 'Days after completion in which a trip can still be rated.'),
  ('support.auto_close_days', '7', 'Resolved tickets close automatically after this many days.')
on conflict (key) do nothing;

-- Notifies every active admin who holds a permission.
create function private.notify_holders(p_permission text, p_kind text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a record;
begin
  for a in select p.id from public.profiles p where p.role = 'admin' and p.status = 'active' and private.admin_holds(p.id, p_permission) loop
    perform private.notify(a.id, p_kind, p_title, p_body, p_link);
  end loop;
end $$;

-- Cursor pagination over rows that carry created_at and id (fetched with limit + 1).
create function private.page_rows(p_rows jsonb, p_limit integer) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(e.r order by e.n), '[]') from jsonb_array_elements(p_rows) with ordinality e(r, n) where e.n <= p_limit),
    'next_cursor', case when jsonb_array_length(p_rows) > p_limit
      then (p_rows -> (p_limit - 1) ->> 'created_at') || '|' || (p_rows -> (p_limit - 1) ->> 'id') end);
$$;

-- ---------------------------------------------------------------------------
-- Promotions
-- ---------------------------------------------------------------------------
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text check (length(description) <= 500),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  max_discount numeric(10, 2) check (max_discount > 0),
  min_fare numeric(10, 2) not null default 0 check (min_fare >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  zone_ids uuid[] not null default '{}',
  category_ids uuid[] not null default '{}',
  new_users_only boolean not null default false,
  per_user_limit integer not null default 1 check (per_user_limit between 1 and 100),
  total_redemption_limit integer check (total_redemption_limit > 0),
  budget_limit numeric(12, 2) check (budget_limit > 0),
  budget_spent numeric(12, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  created_by uuid references public.profiles (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_promotions_window check (ends_at > starts_at),
  constraint chk_promotions_percent check (discount_type <> 'percent' or discount_value <= 100),
  constraint chk_promotions_budget check (budget_limit is null or budget_spent <= budget_limit)
);
create index idx_promotions_status on public.promotions (status, ends_at);
create trigger trg_promotions_no_delete before delete on public.promotions
  for each row execute function private.forbid_delete();
create trigger trg_promotions_stamp before update on public.promotions
  for each row execute function private.touch_row();

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions (id),
  passenger_id uuid not null references public.profiles (id),
  request_id uuid not null unique references public.ride_requests (id),
  trip_id uuid references public.trips (id),
  reserved_amount numeric(10, 2) not null check (reserved_amount >= 0),
  applied_amount numeric(10, 2) check (applied_amount >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'applied', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_redemption_applied_cap check (applied_amount is null or applied_amount <= reserved_amount)
);
create index idx_redemptions_promo on public.promotion_redemptions (promotion_id, status);
create index idx_redemptions_passenger on public.promotion_redemptions (passenger_id, promotion_id);
create trigger trg_redemptions_no_delete before delete on public.promotion_redemptions
  for each row execute function private.forbid_delete();
create trigger trg_redemptions_stamp before update on public.promotion_redemptions
  for each row execute function private.touch_row();

-- Discount a promotion gives on a given fare (before discount), honouring its cap.
create function private.promo_amount(p_promo public.promotions, p_fare numeric) returns numeric
language sql immutable set search_path = '' as $$
  select least(
    greatest(p_fare, 0),
    coalesce(p_promo.max_discount, 1e9),
    case when p_promo.discount_type = 'percent' then round(p_fare * p_promo.discount_value / 100, 0) else p_promo.discount_value end);
$$;

-- Applies a promotion code to an open ride request, reserving budget atomically.
create function api.apply_promo(p_request_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  p public.promotions;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_amount numeric;
  v_updated integer;
begin
  perform private.require_role('passenger');
  select * into r from public.ride_requests where id = p_request_id and passenger_id = auth.uid() for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status not in ('searching', 'matched') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  if exists (select 1 from public.trips t where t.request_id = r.id and t.status in ('in_progress', 'completed')) then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the ride has started"}');
  end if;
  if exists (select 1 from public.promotion_redemptions where request_id = r.id and status <> 'released') then
    perform private.raise_error('PROMO_INVALID', '{"reason":"a promotion is already applied"}');
  end if;

  select * into p from public.promotions where code = v_code for update;
  if not found or p.status <> 'active' or now() < p.starts_at or now() >= p.ends_at then
    perform private.raise_error('PROMO_INVALID', '{"reason":"this code is not valid right now"}');
  end if;
  if cardinality(p.zone_ids) > 0 and not (r.zone_id = any (p.zone_ids)) then
    perform private.raise_error('PROMO_INVALID', '{"reason":"not available in this area"}');
  end if;
  if cardinality(p.category_ids) > 0 and not (r.category_id = any (p.category_ids)) then
    perform private.raise_error('PROMO_INVALID', '{"reason":"not available for this vehicle type"}');
  end if;
  if r.estimated_fare < p.min_fare then
    perform private.raise_error('PROMO_INVALID', jsonb_build_object('reason', 'minimum fare is ' || p.min_fare));
  end if;
  if p.new_users_only and exists (select 1 from public.trips t where t.passenger_id = auth.uid() and t.status = 'completed') then
    perform private.raise_error('PROMO_INVALID', '{"reason":"for new passengers only"}');
  end if;
  if (select count(*) from public.promotion_redemptions x where x.promotion_id = p.id and x.passenger_id = auth.uid() and x.status <> 'released') >= p.per_user_limit then
    perform private.raise_error('PROMO_INVALID', '{"reason":"you have used this code the maximum number of times"}');
  end if;
  if p.total_redemption_limit is not null
     and (select count(*) from public.promotion_redemptions x where x.promotion_id = p.id and x.status <> 'released') >= p.total_redemption_limit then
    perform private.raise_error('PROMO_INVALID', '{"reason":"this offer has been fully redeemed"}');
  end if;

  v_amount := private.promo_amount(p, r.estimated_fare);
  -- Budget reservation: one conditional update, so concurrent requests can never overspend.
  update public.promotions set budget_spent = budget_spent + v_amount
  where id = p.id and (budget_limit is null or budget_spent + v_amount <= budget_limit);
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    perform private.raise_error('PROMO_INVALID', '{"reason":"this offer has run out"}');
  end if;

  insert into public.promotion_redemptions (promotion_id, passenger_id, request_id, reserved_amount)
  values (p.id, auth.uid(), r.id, v_amount);
  return jsonb_build_object('code', p.code, 'name', p.name, 'estimated_discount', v_amount, 'estimated_fare', r.estimated_fare);
end $$;

-- Discount for a request at completion: never more than was reserved.
create function private.promo_discount(p_request_id uuid, p_fare_before_discount numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select least(private.promo_amount(p, p_fare_before_discount), x.reserved_amount)
    from public.promotion_redemptions x join public.promotions p on p.id = x.promotion_id
    where x.request_id = p_request_id and x.status = 'reserved'), 0);
$$;

-- Marks the redemption applied and returns the unused part of the reservation to the budget.
create function private.apply_redemption(p_request_id uuid, p_trip_id uuid, p_discount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.promotion_redemptions;
begin
  select * into x from public.promotion_redemptions where request_id = p_request_id and status = 'reserved' for update;
  if not found then
    return;
  end if;
  update public.promotion_redemptions set status = 'applied', applied_amount = least(p_discount, reserved_amount), trip_id = p_trip_id
  where id = x.id;
  update public.promotions set budget_spent = budget_spent - (x.reserved_amount - least(p_discount, x.reserved_amount))
  where id = x.promotion_id;
end $$;

-- Releases reservations whose request ended without a completed trip (runs every minute).
create function private.release_dead_reservations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  x record;
  n integer := 0;
begin
  for x in
    select d.id, d.promotion_id, d.reserved_amount from public.promotion_redemptions d
    join public.ride_requests r on r.id = d.request_id
    where d.status = 'reserved' and r.status in ('no_driver_found', 'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed')
    order by d.id for update of d skip locked
  loop
    update public.promotion_redemptions set status = 'released' where id = x.id;
    update public.promotions set budget_spent = greatest(budget_spent - x.reserved_amount, 0) where id = x.promotion_id;
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('release-promo-reservations', '* * * * *', 'select private.release_dead_reservations()');

-- Admin ----------------------------------------------------------------------------
create function private.promotion_json(p public.promotions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'code', p.code, 'name', p.name, 'description', p.description, 'discount_type', p.discount_type,
    'discount_value', p.discount_value, 'max_discount', p.max_discount, 'min_fare', p.min_fare, 'starts_at', p.starts_at,
    'ends_at', p.ends_at, 'zone_ids', p.zone_ids, 'category_ids', p.category_ids, 'new_users_only', p.new_users_only,
    'per_user_limit', p.per_user_limit, 'total_redemption_limit', p.total_redemption_limit, 'budget_limit', p.budget_limit,
    'budget_spent', p.budget_spent, 'status', p.status, 'version', p.version, 'created_at', p.created_at,
    'redemptions', (select count(*) from public.promotion_redemptions x where x.promotion_id = p.id and x.status <> 'released'),
    'live', p.status = 'active' and now() >= p.starts_at and now() < p.ends_at);
$$;

create function api.list_promotions(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('promotions.view');
  return (select coalesce(jsonb_agg(private.promotion_json(p) order by p.created_at desc), '[]')
          from public.promotions p where p_status is null or p.status = p_status);
end $$;

create function api.get_promotion(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.promotions;
begin
  perform private.require_permission('promotions.view');
  select * into p from public.promotions where id = p_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return private.promotion_json(p) || jsonb_build_object('roi', (
    select jsonb_build_object(
      'applied', count(*) filter (where x.status = 'applied'),
      'reserved', count(*) filter (where x.status = 'reserved'),
      'released', count(*) filter (where x.status = 'released'),
      'discount_spend', coalesce(sum(x.applied_amount) filter (where x.status = 'applied'), 0),
      'gross_fares', coalesce(sum(b.total_amount + b.discount_amount) filter (where x.status = 'applied'), 0),
      'contribution', coalesce(sum(b.platform_commission + b.booking_fee - b.discount_amount) filter (where x.status = 'applied'), 0),
      'new_passengers', count(*) filter (where x.status = 'applied' and not exists (
        select 1 from public.trips t2 where t2.passenger_id = x.passenger_id and t2.status = 'completed' and t2.completed_at < t.completed_at)))
    from public.promotion_redemptions x
    left join public.trips t on t.id = x.trip_id
    left join public.trip_fare_breakdowns b on b.trip_id = x.trip_id
    where x.promotion_id = p.id));
end $$;

-- Creates (p_id null) or edits a promotion. Payload keys are validated strictly.
create function api.save_promotion(p_id uuid, p_payload jsonb, p_expected_version integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.promotions;
  v_before jsonb;
  v_allowed text[] := array['code', 'name', 'description', 'discount_type', 'discount_value', 'max_discount', 'min_fare', 'starts_at', 'ends_at',
    'zone_ids', 'category_ids', 'new_users_only', 'per_user_limit', 'total_redemption_limit', 'budget_limit'];
  k text;
  v_code text;
begin
  perform private.require_permission('promotions.manage');
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    perform private.raise_error('VALIDATION_FAILED');
  end if;
  for k in select jsonb_object_keys(p_payload) loop
    if not (k = any (v_allowed)) then
      perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('path', k, 'message', 'Unknown field.'))));
    end if;
  end loop;

  begin
    if p_id is null then
      v_code := upper(btrim(p_payload ->> 'code'));
      insert into public.promotions (code, name, description, discount_type, discount_value, max_discount, min_fare, starts_at, ends_at,
        zone_ids, category_ids, new_users_only, per_user_limit, total_redemption_limit, budget_limit, created_by)
      values (v_code, btrim(p_payload ->> 'name'), nullif(btrim(p_payload ->> 'description'), ''), p_payload ->> 'discount_type',
        (p_payload ->> 'discount_value')::numeric, (p_payload ->> 'max_discount')::numeric, coalesce((p_payload ->> 'min_fare')::numeric, 0),
        (p_payload ->> 'starts_at')::timestamptz, (p_payload ->> 'ends_at')::timestamptz,
        coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_payload -> 'zone_ids') x), '{}'),
        coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_payload -> 'category_ids') x), '{}'),
        coalesce((p_payload ->> 'new_users_only')::boolean, false), coalesce((p_payload ->> 'per_user_limit')::int, 1),
        (p_payload ->> 'total_redemption_limit')::int, (p_payload ->> 'budget_limit')::numeric, auth.uid())
      returning * into p;
      perform private.log_admin_action('promotion.create', 'promotion', p.id, null, private.promotion_json(p), null);
    else
      select * into p from public.promotions where id = p_id for update;
      if not found then
        perform private.raise_error('NOT_FOUND');
      end if;
      if p_expected_version is not null and p.version <> p_expected_version then
        perform private.raise_error('STALE_VERSION');
      end if;
      if p.status = 'ended' then
        perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"an ended promotion cannot be edited"}');
      end if;
      v_before := private.promotion_json(p);
      -- Money terms are frozen once redemptions exist; everything else stays editable.
      if exists (select 1 from public.promotion_redemptions where promotion_id = p.id)
         and (p_payload ? 'discount_type' or p_payload ? 'discount_value' or p_payload ? 'code') then
        perform private.raise_error('IMMUTABLE_ROW', '{"reason":"code and discount cannot change after redemptions exist"}');
      end if;
      update public.promotions set
        code = case when p_payload ? 'code' then upper(btrim(p_payload ->> 'code')) else code end,
        name = coalesce(btrim(p_payload ->> 'name'), name),
        description = case when p_payload ? 'description' then nullif(btrim(p_payload ->> 'description'), '') else description end,
        discount_type = coalesce(p_payload ->> 'discount_type', discount_type),
        discount_value = coalesce((p_payload ->> 'discount_value')::numeric, discount_value),
        max_discount = case when p_payload ? 'max_discount' then (p_payload ->> 'max_discount')::numeric else max_discount end,
        min_fare = coalesce((p_payload ->> 'min_fare')::numeric, min_fare),
        starts_at = coalesce((p_payload ->> 'starts_at')::timestamptz, starts_at),
        ends_at = coalesce((p_payload ->> 'ends_at')::timestamptz, ends_at),
        zone_ids = case when p_payload ? 'zone_ids' then coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_payload -> 'zone_ids') x), '{}') else zone_ids end,
        category_ids = case when p_payload ? 'category_ids' then coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_payload -> 'category_ids') x), '{}') else category_ids end,
        new_users_only = coalesce((p_payload ->> 'new_users_only')::boolean, new_users_only),
        per_user_limit = coalesce((p_payload ->> 'per_user_limit')::int, per_user_limit),
        total_redemption_limit = case when p_payload ? 'total_redemption_limit' then (p_payload ->> 'total_redemption_limit')::int else total_redemption_limit end,
        budget_limit = case when p_payload ? 'budget_limit' then (p_payload ->> 'budget_limit')::numeric else budget_limit end,
        version = version + 1
      where id = p.id returning * into p;
      perform private.log_admin_action('promotion.update', 'promotion', p.id, v_before, private.promotion_json(p), null);
    end if;
  exception
    when unique_violation then
      perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"code","message":"This code is already used."}]}');
    when check_violation or invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range or not_null_violation then
      perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('path', 'promotion', 'message', 'Check the code, dates, discount and limits.'))));
  end;
  return private.promotion_json(p);
end $$;

create function api.set_promotion_status(p_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.promotions;
  v_reason text := private.require_reason(p_reason);
  v_before jsonb;
begin
  perform private.require_permission('promotions.manage');
  select * into p from public.promotions where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if not ((p.status = 'draft' and p_status in ('active', 'ended'))
       or (p.status = 'active' and p_status in ('paused', 'ended'))
       or (p.status = 'paused' and p_status in ('active', 'ended'))) then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('from', p.status, 'to', p_status));
  end if;
  v_before := private.promotion_json(p);
  update public.promotions set status = p_status, version = version + 1 where id = p.id returning * into p;
  perform private.log_admin_action('promotion.' || p_status, 'promotion', p.id, v_before, private.promotion_json(p), v_reason);
  return private.promotion_json(p);
end $$;

-- ---------------------------------------------------------------------------
-- Support tickets
-- ---------------------------------------------------------------------------
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity unique,
  requester_id uuid not null references public.profiles (id),
  requester_role public.app_role not null,
  trip_id uuid references public.trips (id),
  category text not null check (category in ('payment', 'trip', 'driver', 'passenger', 'safety', 'account', 'other')),
  subject text not null check (length(btrim(subject)) between 3 and 200),
  status public.ticket_status not null default 'open',
  priority public.ticket_priority not null default 'normal',
  channel text not null default 'app' check (channel in ('app', 'admin', 'system')),
  assignee_id uuid references public.profiles (id),
  sla_due_at timestamptz not null,
  sla_breach_notified_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  tags text[] not null default '{}',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_tickets_status on public.support_tickets (status, priority, created_at desc);
create index idx_tickets_requester on public.support_tickets (requester_id, created_at desc);
create index idx_tickets_assignee on public.support_tickets (assignee_id, status) where assignee_id is not null;
create index idx_tickets_sla on public.support_tickets (sla_due_at) where status in ('open', 'in_progress');
create trigger trg_tickets_no_delete before delete on public.support_tickets
  for each row execute function private.forbid_delete();
create trigger trg_tickets_stamp before update on public.support_tickets
  for each row execute function private.touch_row();

create table public.support_ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets (id),
  author_id uuid references public.profiles (id),
  author_type text not null check (author_type in ('user', 'admin', 'system')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chk_ticket_internal_admin check (not is_internal or author_type in ('admin', 'system'))
);
create index idx_ticket_messages_ticket on public.support_ticket_messages (ticket_id, id);
create trigger trg_ticket_messages_append_only before update or delete on public.support_ticket_messages
  for each row execute function private.forbid_update_delete();

create function private.ticket_sla(p_priority public.ticket_priority) returns interval
language sql immutable set search_path = '' as $$
  select case p_priority when 'urgent' then interval '1 hour' when 'high' then interval '4 hours'
                         when 'normal' then interval '24 hours' else interval '72 hours' end;
$$;

create function private.open_ticket(
  p_requester uuid, p_trip_id uuid, p_category text, p_subject text, p_body text,
  p_priority public.ticket_priority, p_channel text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_role public.app_role;
  v_no bigint;
begin
  select role into v_role from public.profiles where id = p_requester;
  insert into public.support_tickets (requester_id, requester_role, trip_id, category, subject, priority, channel, sla_due_at)
  values (p_requester, v_role, p_trip_id, p_category, left(btrim(p_subject), 200), p_priority, p_channel, now() + private.ticket_sla(p_priority))
  returning id, ticket_no into v_id, v_no;
  insert into public.support_ticket_messages (ticket_id, author_id, author_type, body)
  values (v_id, case when p_channel = 'system' then null else p_requester end, case when p_channel = 'system' then 'system' else 'user' end, left(btrim(p_body), 4000));
  perform private.notify_holders('support.manage', 'ticket_new', 'New ticket #' || v_no, left(p_subject, 120), '/support/' || v_id);
  return v_id;
end $$;

-- Users (passenger, driver or not yet onboarded) -----------------------------------
create function api.create_ticket(p_trip_id uuid, p_category text, p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_priority public.ticket_priority := 'normal'::public.ticket_priority;
begin
  if auth.uid() is null or private.current_app_role() = 'admin' then
    perform private.raise_error('ROLE_NOT_ALLOWED');
  end if;
  if p_category is null or p_category not in ('payment', 'trip', 'driver', 'passenger', 'safety', 'account', 'other') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"category","message":"Choose a category."}]}');
  end if;
  if p_subject is null or length(btrim(p_subject)) not between 3 and 200 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"subject","message":"Give the ticket a short subject (3 to 200 characters)."}]}');
  end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 4000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"body","message":"Describe the problem (up to 4,000 characters)."}]}');
  end if;
  if p_trip_id is not null and not exists (
    select 1 from public.trips t where t.id = p_trip_id and (t.passenger_id = auth.uid() or t.driver_id = private.my_driver_id())) then
    perform private.raise_error('NOT_FOUND');
  end if;
  if (select count(*) from public.support_tickets where requester_id = auth.uid() and status in ('open', 'in_progress', 'pending_user')) >= 10 then
    perform private.raise_error('RATE_LIMITED', '{"reason":"too many open tickets"}');
  end if;
  if p_category = 'safety' then
    v_priority := 'high';
  end if;
  v_id := private.open_ticket(auth.uid(), p_trip_id, p_category, p_subject, p_body, v_priority, 'app');
  return api.get_my_ticket(v_id);
end $$;

create function api.list_my_tickets() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'ticket_no', t.ticket_no, 'subject', t.subject, 'category', t.category, 'status', t.status,
      'trip_id', t.trip_id, 'created_at', t.created_at, 'updated_at', t.updated_at) order by t.updated_at desc), '[]')
    from (select * from public.support_tickets where requester_id = auth.uid() order by updated_at desc limit 50) t);
end $$;

create function api.get_my_ticket(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  select jsonb_build_object(
    'id', t.id, 'ticket_no', t.ticket_no, 'subject', t.subject, 'category', t.category, 'status', t.status, 'trip_id', t.trip_id,
    'created_at', t.created_at, 'updated_at', t.updated_at,
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'created_at', m.created_at) order by m.id), '[]')
                 from public.support_ticket_messages m where m.ticket_id = t.id and not m.is_internal))
  into v from public.support_tickets t where t.id = p_id and t.requester_id = auth.uid();
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v;
end $$;

create function api.reply_my_ticket(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  select * into t from public.support_tickets where id = p_id and requester_id = auth.uid() for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if t.status = 'closed' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"this ticket is closed"}');
  end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 4000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"body","message":"Write a reply of up to 4,000 characters."}]}');
  end if;
  insert into public.support_ticket_messages (ticket_id, author_id, author_type, body) values (t.id, auth.uid(), 'user', btrim(p_body));
  if t.status in ('pending_user', 'resolved') then
    update public.support_tickets set status = 'open', resolved_at = null where id = t.id;
  else
    update public.support_tickets set updated_at = now() where id = t.id;
  end if;
  if t.assignee_id is not null then
    perform private.notify(t.assignee_id, 'ticket_reply', 'Reply on ticket #' || t.ticket_no, left(btrim(p_body), 120), '/support/' || t.id);
  end if;
  return api.get_my_ticket(t.id);
end $$;

-- Admin ---------------------------------------------------------------------------
create function private.ticket_row_json(t public.support_tickets) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'ticket_no', t.ticket_no, 'subject', t.subject, 'category', t.category, 'status', t.status, 'priority', t.priority,
    'channel', t.channel, 'requester_id', t.requester_id, 'requester_role', t.requester_role,
    'requester_name', (select full_name from public.profiles p where p.id = t.requester_id),
    'assignee_id', t.assignee_id, 'assignee_name', (select full_name from public.profiles p where p.id = t.assignee_id),
    'trip_id', t.trip_id, 'sla_due_at', t.sla_due_at, 'first_response_at', t.first_response_at,
    'sla_breached', t.status in ('open', 'in_progress') and t.sla_due_at < now() and t.first_response_at is null,
    'tags', t.tags, 'version', t.version, 'created_at', t.created_at, 'updated_at', t.updated_at);
$$;

create function api.list_tickets(
  p_status text default null, p_priority text default null, p_assignee text default null, p_search text default null,
  p_limit integer default 50, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('support.view');
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(private.ticket_row_json(x) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (select t.* from public.support_tickets t
        where (p_status is null or (p_status = 'active' and t.status in ('open', 'in_progress', 'pending_user')) or t.status::text = p_status)
          and (p_priority is null or t.priority::text = p_priority)
          and (p_assignee is null or (p_assignee = 'me' and t.assignee_id = auth.uid()) or (p_assignee = 'unassigned' and t.assignee_id is null))
          and (v_search is null or t.subject ilike '%' || v_search || '%' or t.ticket_no::text = ltrim(v_search, '#'))
          and (v_ts is null or (t.created_at, t.id) < (v_ts, v_id))
        order by t.created_at desc, t.id desc limit v_limit + 1) x;
  return private.page_rows(v_rows, v_limit) || jsonb_build_object('counts', (
    select jsonb_build_object(
      'active', count(*) filter (where status in ('open', 'in_progress', 'pending_user')),
      'unassigned', count(*) filter (where status in ('open', 'in_progress') and assignee_id is null),
      'breached', count(*) filter (where status in ('open', 'in_progress') and sla_due_at < now() and first_response_at is null),
      'mine', count(*) filter (where status in ('open', 'in_progress', 'pending_user') and assignee_id = auth.uid()))
    from public.support_tickets));
end $$;

create function api.get_ticket(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.support_tickets;
begin
  perform private.require_permission('support.view');
  select * into t from public.support_tickets where id = p_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return private.ticket_row_json(t) || jsonb_build_object(
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'is_internal', m.is_internal, 'body', m.body,
        'created_at', m.created_at, 'author_name', (select full_name from public.profiles p where p.id = m.author_id)) order by m.id), '[]')
      from public.support_ticket_messages m where m.ticket_id = t.id),
    'resolved_at', t.resolved_at, 'closed_at', t.closed_at);
end $$;

create function api.reply_ticket(p_id uuid, p_body text, p_internal boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
begin
  perform private.require_permission('support.manage');
  select * into t from public.support_tickets where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if t.status = 'closed' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"this ticket is closed"}');
  end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 4000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"body","message":"Write a message of up to 4,000 characters."}]}');
  end if;
  insert into public.support_ticket_messages (ticket_id, author_id, author_type, body, is_internal)
  values (t.id, auth.uid(), 'admin', btrim(p_body), coalesce(p_internal, false));
  if not coalesce(p_internal, false) then
    update public.support_tickets set
      first_response_at = coalesce(first_response_at, now()),
      status = case when status = 'open' then 'in_progress' else status end,
      assignee_id = coalesce(assignee_id, auth.uid())
    where id = t.id;
    perform private.notify(t.requester_id, 'ticket_reply', 'Support replied to ticket #' || t.ticket_no, left(btrim(p_body), 120), null);
  else
    update public.support_tickets set updated_at = now() where id = t.id;
  end if;
  return api.get_ticket(t.id);
end $$;

create function api.assign_ticket(p_id uuid, p_assignee uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
begin
  perform private.require_permission('support.assign');
  select * into t from public.support_tickets where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p_assignee is not null and not (private.is_active_admin(p_assignee) and private.admin_holds(p_assignee, 'support.manage')) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"assignee","message":"Choose an active admin who can manage tickets."}]}');
  end if;
  update public.support_tickets set assignee_id = p_assignee where id = t.id;
  perform private.log_admin_action('ticket.assign', 'ticket', t.id, jsonb_build_object('assignee_id', t.assignee_id), jsonb_build_object('assignee_id', p_assignee), null);
  if p_assignee is not null and p_assignee <> auth.uid() then
    perform private.notify(p_assignee, 'ticket_assigned', 'Ticket #' || t.ticket_no || ' was assigned to you', left(t.subject, 120), '/support/' || t.id);
  end if;
  return api.get_ticket(t.id);
end $$;

create function api.set_ticket_status(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
begin
  perform private.require_permission('support.manage');
  select * into t from public.support_tickets where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p_status not in ('open', 'in_progress', 'pending_user', 'resolved', 'closed') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  if (p_status = 'closed' and t.status <> 'resolved') or (t.status = 'closed' and p_status <> 'open') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('from', t.status, 'to', p_status));
  end if;
  update public.support_tickets set status = p_status::public.ticket_status,
    resolved_at = case when p_status = 'resolved' then now() when p_status in ('open', 'in_progress') then null else resolved_at end,
    closed_at = case when p_status = 'closed' then now() else closed_at end
  where id = t.id;
  if nullif(btrim(p_note), '') is not null then
    insert into public.support_ticket_messages (ticket_id, author_id, author_type, body, is_internal)
    values (t.id, auth.uid(), 'admin', btrim(p_note), true);
  end if;
  perform private.log_admin_action('ticket.status', 'ticket', t.id, jsonb_build_object('status', t.status), jsonb_build_object('status', p_status), null);
  return api.get_ticket(t.id);
end $$;

create function api.set_ticket_priority(p_id uuid, p_priority text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
begin
  perform private.require_permission('support.manage');
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"priority","message":"Unknown priority."}]}');
  end if;
  select * into t from public.support_tickets where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  update public.support_tickets set priority = p_priority::public.ticket_priority,
    sla_due_at = created_at + private.ticket_sla(p_priority::public.ticket_priority) where id = t.id;
  perform private.log_admin_action('ticket.priority', 'ticket', t.id, jsonb_build_object('priority', t.priority), jsonb_build_object('priority', p_priority), null);
  return api.get_ticket(t.id);
end $$;

-- Auto-close resolved tickets and alert on SLA breaches (every 10 minutes).
create function private.ticket_housekeeping() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_days integer := coalesce((private.setting('support.auto_close_days'))::int, 7);
  t record;
begin
  update public.support_tickets set status = 'closed', closed_at = now()
  where status = 'resolved' and resolved_at < now() - make_interval(days => v_days);
  for t in
    select id, ticket_no, subject, assignee_id from public.support_tickets
    where status in ('open', 'in_progress') and sla_due_at < now() and first_response_at is null and sla_breach_notified_at is null
    for update skip locked
  loop
    update public.support_tickets set sla_breach_notified_at = now() where id = t.id;
    perform private.notify_holders('support.assign', 'ticket_sla', 'SLA breached on ticket #' || t.ticket_no, left(t.subject, 120), '/support/' || t.id);
  end loop;
end $$;
select cron.schedule('ticket-housekeeping', '*/10 * * * *', 'select private.ticket_housekeeping()');

-- ---------------------------------------------------------------------------
-- Ratings
-- ---------------------------------------------------------------------------
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id),
  reviewer_id uuid not null references public.profiles (id),
  reviewee_id uuid not null references public.profiles (id),
  reviewer_role public.app_role not null check (reviewer_role in ('passenger', 'driver')),
  score smallint not null check (score between 1 and 5),
  comment text check (length(comment) <= 1000),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id),
  hidden_reason text,
  created_at timestamptz not null default now(),
  constraint uq_ratings_trip_reviewer unique (trip_id, reviewer_id)
);
create index idx_ratings_reviewee on public.ratings (reviewee_id, created_at desc) where hidden_at is null;
create index idx_ratings_low on public.ratings (created_at desc) where score <= 2;
create trigger trg_ratings_no_delete before delete on public.ratings
  for each row execute function private.forbid_delete();

create function private.refresh_driver_rating(p_driver_profile uuid) returns void
language sql security definer set search_path = '' as $$
  update public.driver_profiles d set
    rating_avg = (select round(avg(r.score)::numeric, 2) from public.ratings r join public.driver_profiles dp on dp.user_id = r.reviewee_id
                  where dp.id = p_driver_profile and r.reviewer_role = 'passenger' and r.hidden_at is null),
    rating_count = (select count(*) from public.ratings r join public.driver_profiles dp on dp.user_id = r.reviewee_id
                    where dp.id = p_driver_profile and r.reviewer_role = 'passenger' and r.hidden_at is null)
  where d.id = p_driver_profile;
$$;

create function api.rate_trip(p_trip_id uuid, p_score integer, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_role public.app_role := private.current_app_role();
  v_reviewee uuid;
  v_window integer := coalesce((private.setting('ratings.window_days'))::int, 7);
  v_comment text := nullif(btrim(p_comment), '');
  v_id uuid;
begin
  if v_role not in ('passenger', 'driver') then
    perform private.raise_error('ROLE_NOT_ALLOWED');
  end if;
  if p_score is null or p_score not between 1 and 5 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"score","message":"Choose a score from 1 to 5."}]}');
  end if;
  if v_comment is not null and length(v_comment) > 1000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"comment","message":"Keep the comment under 1,000 characters."}]}');
  end if;
  select * into t from public.trips where id = p_trip_id and status = 'completed'
    and (passenger_id = auth.uid() or driver_id = private.my_driver_id());
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if t.completed_at < now() - make_interval(days => v_window) then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the rating window has closed"}');
  end if;
  if v_role = 'passenger' then
    select d.user_id into v_reviewee from public.driver_profiles d where d.id = t.driver_id;
  else
    v_reviewee := t.passenger_id;
  end if;
  begin
    insert into public.ratings (trip_id, reviewer_id, reviewee_id, reviewer_role, score, comment)
    values (t.id, auth.uid(), v_reviewee, v_role, p_score, v_comment) returning id into v_id;
  exception when unique_violation then
    perform private.raise_error('ALREADY_EXISTS', '{"reason":"you already rated this trip"}');
  end;
  if v_role = 'passenger' then
    perform private.refresh_driver_rating(t.driver_id);
  end if;
  if p_score <= 2 and v_comment is not null then
    perform private.open_ticket(auth.uid(), t.id, case when v_role = 'passenger' then 'driver' else 'passenger' end,
      'Low rating (' || p_score || '/5)', v_comment, 'low', 'system');
  end if;
  return jsonb_build_object('id', v_id, 'trip_id', t.id, 'score', p_score);
end $$;

create function api.list_ratings(p_max_score integer default null, p_hidden boolean default false, p_limit integer default 50, p_cursor text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('support.view');
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'trip_id', x.trip_id, 'score', x.score, 'comment', x.comment, 'reviewer_role', x.reviewer_role,
      'reviewer_name', (select full_name from public.profiles p where p.id = x.reviewer_id),
      'reviewee_name', (select full_name from public.profiles p where p.id = x.reviewee_id),
      'hidden', x.hidden_at is not null, 'hidden_reason', x.hidden_reason, 'created_at', x.created_at) order by x.created_at desc, x.id desc), '[]')
  into v_rows
  from (select r.* from public.ratings r
        where (p_max_score is null or r.score <= p_max_score) and ((r.hidden_at is not null) = coalesce(p_hidden, false))
          and (v_ts is null or (r.created_at, r.id) < (v_ts, v_id))
        order by r.created_at desc, r.id desc limit v_limit + 1) x;
  return private.page_rows(v_rows, v_limit);
end $$;

create function api.hide_rating(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.ratings;
  v_reason text := private.require_reason(p_reason);
  v_driver uuid;
begin
  perform private.require_permission('support.manage');
  select * into r from public.ratings where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.hidden_at is not null then
    return;
  end if;
  update public.ratings set hidden_at = now(), hidden_by = auth.uid(), hidden_reason = v_reason where id = r.id;
  select d.id into v_driver from public.driver_profiles d where d.user_id = r.reviewee_id;
  if v_driver is not null then
    perform private.refresh_driver_rating(v_driver);
  end if;
  perform private.log_admin_action('rating.hide', 'rating', r.id, jsonb_build_object('score', r.score), null, v_reason);
end $$;

-- ---------------------------------------------------------------------------
-- Safety incidents and SOS
-- ---------------------------------------------------------------------------
create table public.safety_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_no bigint generated always as identity unique,
  trip_id uuid references public.trips (id),
  reporter_id uuid not null references public.profiles (id),
  reporter_role public.app_role not null,
  kind text not null default 'sos' check (kind in ('sos', 'accident', 'harassment', 'other')),
  severity public.incident_severity not null default 'critical',
  status public.incident_status not null default 'reported',
  description text check (length(description) <= 2000),
  location extensions.geography(Point, 4326),
  reported_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  assignee_id uuid references public.profiles (id),
  escalated_to text check (length(escalated_to) <= 200),
  resolution text check (length(resolution) <= 2000),
  resolved_at timestamptz,
  closed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_incidents_open on public.safety_incidents (severity, reported_at desc) where status not in ('resolved', 'closed');
create index idx_incidents_trip on public.safety_incidents (trip_id) where trip_id is not null;
-- One live SOS per reporter per trip: pressing the button twice never creates a second incident.
create unique index uq_incidents_open_sos on public.safety_incidents (trip_id, reporter_id) where kind = 'sos' and status not in ('resolved', 'closed');
create trigger trg_incidents_no_delete before delete on public.safety_incidents
  for each row execute function private.forbid_delete();
create trigger trg_incidents_stamp before update on public.safety_incidents
  for each row execute function private.touch_row();

create table public.safety_incident_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.safety_incidents (id),
  from_status public.incident_status,
  to_status public.incident_status not null,
  actor_id uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);
create index idx_incident_events on public.safety_incident_events (incident_id, id);
create trigger trg_incident_events_append_only before update or delete on public.safety_incident_events
  for each row execute function private.forbid_update_delete();

-- SOS: passenger or driver of an active trip. Idempotent while an SOS for the trip is still open.
create function api.trigger_sos(p_trip_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_role public.app_role := private.current_app_role();
  v_loc extensions.geography;
  v_id uuid;
  v_no bigint;
  v_note text := left(nullif(btrim(p_note), ''), 2000);
begin
  if v_role not in ('passenger', 'driver') then
    perform private.raise_error('ROLE_NOT_ALLOWED');
  end if;
  select * into t from public.trips where id = p_trip_id and (passenger_id = auth.uid() or driver_id = private.my_driver_id());
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if t.status not in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', t.status));
  end if;
  select id, incident_no into v_id, v_no from public.safety_incidents
  where trip_id = t.id and reporter_id = auth.uid() and kind = 'sos' and status not in ('resolved', 'closed');
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'incident_no', v_no, 'status', 'reported', 'repeat', true);
  end if;

  select location into v_loc from public.driver_live_locations where driver_id = t.driver_id;
  insert into public.safety_incidents (trip_id, reporter_id, reporter_role, kind, severity, description, location)
  values (t.id, auth.uid(), v_role, 'sos', 'critical', v_note, v_loc) returning id, incident_no into v_id, v_no;
  insert into public.safety_incident_events (incident_id, to_status, actor_id, note) values (v_id, 'reported', auth.uid(), v_note);

  perform private.broadcast('ops:safety', 'sos', jsonb_build_object('id', v_id, 'incident_no', v_no, 'trip_id', t.id));
  perform private.notify_holders('safety.view', 'sos', 'SOS #' || v_no, 'A ' || v_role || ' triggered SOS on an active trip.', '/safety/' || v_id);
  return jsonb_build_object('id', v_id, 'incident_no', v_no, 'status', 'reported', 'repeat', false);
end $$;

create function private.incident_row_json(i public.safety_incidents) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'incident_no', i.incident_no, 'trip_id', i.trip_id, 'kind', i.kind, 'severity', i.severity, 'status', i.status,
    'reporter_role', i.reporter_role, 'reporter_name', (select full_name from public.profiles p where p.id = i.reporter_id),
    'assignee_name', (select full_name from public.profiles p where p.id = i.assignee_id),
    'reported_at', i.reported_at, 'created_at', i.created_at, 'acknowledged_at', i.acknowledged_at,
    'seconds_to_acknowledge', case when i.acknowledged_at is not null then round(extract(epoch from i.acknowledged_at - i.reported_at)) end,
    'open_seconds', case when i.status not in ('resolved', 'closed') then round(extract(epoch from now() - i.reported_at)) end);
$$;

create function api.list_incidents(p_status text default 'open', p_limit integer default 50, p_cursor text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('safety.view');
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(private.incident_row_json(x) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (select i.* from public.safety_incidents i
        where (p_status is null or (p_status = 'open' and i.status not in ('resolved', 'closed')) or (p_status = 'done' and i.status in ('resolved', 'closed')) or i.status::text = p_status)
          and (v_ts is null or (i.created_at, i.id) < (v_ts, v_id))
        order by i.created_at desc, i.id desc limit v_limit + 1) x;
  return private.page_rows(v_rows, v_limit) || jsonb_build_object('counts', (
    select jsonb_build_object(
      'open', count(*) filter (where status not in ('resolved', 'closed')),
      'unacknowledged', count(*) filter (where status = 'reported'),
      'critical', count(*) filter (where status not in ('resolved', 'closed') and severity = 'critical'))
    from public.safety_incidents));
end $$;

create function api.get_incident(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.safety_incidents;
  v_coords boolean := private.has_permission('trips.view_location');
begin
  perform private.require_permission('safety.view');
  select * into i from public.safety_incidents where id = p_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_coords and i.location is not null then
    insert into public.pii_access_logs (admin_id, subject_profile_id, field, reason)
    values (auth.uid(), i.reporter_id, 'safety_incident_location', 'incident ' || i.incident_no);
  end if;
  return private.incident_row_json(i) || jsonb_build_object(
    'description', i.description, 'escalated_to', i.escalated_to, 'resolution', i.resolution, 'version', i.version,
    'location', case when v_coords and i.location is not null then jsonb_build_object('lat', extensions.st_y(i.location::extensions.geometry), 'lng', extensions.st_x(i.location::extensions.geometry)) end,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'from_status', e.from_status, 'to_status', e.to_status, 'note', e.note, 'created_at', e.created_at,
        'actor_name', (select full_name from public.profiles p where p.id = e.actor_id)) order by e.id), '[]')
      from public.safety_incident_events e where e.incident_id = i.id));
end $$;

create function api.advance_incident(p_id uuid, p_status text, p_note text, p_escalated_to text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.safety_incidents;
  v_note text := private.require_reason(p_note);
begin
  perform private.require_permission('safety.manage');
  select * into i from public.safety_incidents where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if not (
    (i.status = 'reported' and p_status = 'acknowledged')
    or (i.status = 'acknowledged' and p_status in ('investigating', 'resolved'))
    or (i.status = 'investigating' and p_status in ('escalated', 'resolved'))
    or (i.status = 'escalated' and p_status in ('investigating', 'resolved'))
    or (i.status = 'resolved' and p_status in ('closed', 'investigating'))) then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('from', i.status, 'to', p_status));
  end if;
  update public.safety_incidents set
    status = p_status::public.incident_status,
    acknowledged_at = case when p_status = 'acknowledged' then now() else acknowledged_at end,
    assignee_id = coalesce(assignee_id, auth.uid()),
    escalated_to = case when p_status = 'escalated' then left(nullif(btrim(p_escalated_to), ''), 200) else escalated_to end,
    resolution = case when p_status = 'resolved' then v_note else resolution end,
    resolved_at = case when p_status = 'resolved' then now() when p_status = 'investigating' then null else resolved_at end,
    closed_at = case when p_status = 'closed' then now() else closed_at end,
    version = version + 1
  where id = i.id;
  insert into public.safety_incident_events (incident_id, from_status, to_status, actor_id, note)
  values (i.id, i.status, p_status::public.incident_status, auth.uid(), v_note);
  perform private.log_admin_action('incident.' || p_status, 'safety_incident', i.id, jsonb_build_object('status', i.status), jsonb_build_object('status', p_status), v_note);
  return api.get_incident(i.id);
end $$;

-- ops:safety is readable by safety viewers only.
create or replace function private.can_receive_topic(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_topic = 'ops:live' then private.has_permission('dispatch.view')
    when p_topic = 'ops:safety' then private.has_permission('safety.view')
    when p_topic like 'driver:%' then p_topic = 'driver:' || coalesce(private.my_driver_id()::text, '-')
    when p_topic like 'ride:%' then
      exists (select 1 from public.ride_requests r where r.id::text = substr(p_topic, 6) and r.passenger_id = auth.uid())
      or exists (select 1 from public.trips t where t.request_id::text = substr(p_topic, 6) and t.driver_id = private.my_driver_id())
    else false end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('promotions', 'promotions.view'), ('promotion_redemptions', 'promotions.view'),
      ('support_tickets', 'support.view'), ('support_ticket_messages', 'support.manage'),
      ('ratings', 'support.view'), ('safety_incidents', 'safety.view'), ('safety_incident_events', 'safety.view')
    ) as x(tbl, perm)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('alter table public.%I force row level security', r.tbl);
    execute format('revoke all on public.%I from public, anon, authenticated', r.tbl);
    execute format('grant select on public.%I to authenticated', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.has_permission(%L)))', r.tbl || '_admin_read', r.tbl, r.perm);
  end loop;
end $$;
