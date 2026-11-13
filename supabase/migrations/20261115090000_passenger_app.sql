-- Passenger app support (rider-passenger docs/spec/05-quality-delivery.md §14, gaps B4–B7, B9, B11, B13, B2–B3).
--   * consent recording on the profile (B13)
--   * notification preferences (B4), saved places (B6), trusted contacts (B7)
--   * trip share links with a public, read-only view (B5)
--   * the passenger's current ride (B9)
--   * live ETA and nearby-driver count per category (B11)
--   * push data payloads in the outbox, and passenger push events on ride, support and safety changes (B2–B3)

-- ---------------------------------------------------------------------------
-- Consent (B13)
-- ---------------------------------------------------------------------------
alter table public.profiles add column terms_version text, add column terms_accepted_at timestamptz;
alter table public.profiles add constraint chk_profiles_terms_version check (terms_version is null or terms_version ~ '^[0-9A-Za-z.-]{1,20}$');

create function api.record_consent(p_terms_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_terms_version is null or p_terms_version !~ '^[0-9A-Za-z.-]{1,20}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"terms_version","message":"Send the version of the terms you accepted."}]}');
  end if;
  update public.profiles set terms_version = p_terms_version, terms_accepted_at = now() where id = auth.uid();
  return jsonb_build_object('terms_version', p_terms_version, 'accepted_at', now());
end $$;

-- ---------------------------------------------------------------------------
-- Notification preferences (B4). No row = defaults: ride and support on, offers off. Safety is always on.
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id),
  ride boolean not null default true,
  support boolean not null default true,
  offers boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
create trigger trg_notification_preferences_no_delete before delete on public.notification_preferences
  for each row execute function private.forbid_delete();

create function private.wants_push(p_user uuid, p_category text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_category
    when 'safety' then true
    when 'ride' then coalesce((select ride from public.notification_preferences where user_id = p_user), true)
    when 'support' then coalesce((select support from public.notification_preferences where user_id = p_user), true)
    when 'offers' then coalesce((select offers from public.notification_preferences where user_id = p_user), false)
    else true end;
$$;

create function api.get_notification_preferences() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  return jsonb_build_object('ride', private.wants_push(auth.uid(), 'ride'), 'support', private.wants_push(auth.uid(), 'support'),
    'offers', private.wants_push(auth.uid(), 'offers'), 'safety', true);
end $$;

create function api.set_notification_preferences(p_ride boolean, p_support boolean, p_offers boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  insert into public.notification_preferences (user_id, ride, support, offers)
  values (auth.uid(), coalesce(p_ride, true), coalesce(p_support, true), coalesce(p_offers, false))
  on conflict (user_id) do update set ride = excluded.ride, support = excluded.support, offers = excluded.offers, updated_at = now();
  return api.get_notification_preferences();
end $$;

-- ---------------------------------------------------------------------------
-- Saved places (B6): Home and Office are unique per person; "other" places are named. Soft-deleted.
-- ---------------------------------------------------------------------------
create table public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('home', 'office', 'other')),
  name text check (name is null or length(btrim(name)) between 1 and 40),
  label text not null check (length(btrim(label)) between 1 and 200),
  subtitle text check (subtitle is null or length(subtitle) <= 200),
  point extensions.geography(Point, 4326) not null,
  driver_note text check (driver_note is null or length(driver_note) <= 300),
  suggest_mornings boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_saved_places_other_named check (kind <> 'other' or name is not null)
);
create unique index uq_saved_places_kind on public.saved_places (user_id, kind) where deleted_at is null and kind in ('home', 'office');
create index idx_saved_places_user on public.saved_places (user_id) where deleted_at is null;
alter table public.saved_places enable row level security;
alter table public.saved_places force row level security;
revoke all on public.saved_places from public, anon, authenticated;
create trigger trg_saved_places_no_delete before delete on public.saved_places
  for each row execute function private.forbid_delete();
create trigger trg_saved_places_change_log after insert or update or delete on public.saved_places
  for each row execute function audit.log_change();

create function private.saved_place_json(p public.saved_places) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'label', p.label, 'subtitle', p.subtitle,
    'lat', extensions.st_y(p.point::extensions.geometry), 'lng', extensions.st_x(p.point::extensions.geometry),
    'driver_note', p.driver_note, 'suggest_mornings', p.suggest_mornings, 'updated_at', p.updated_at);
$$;

create function api.list_saved_places() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  return (select coalesce(jsonb_agg(private.saved_place_json(p) order by p.kind, p.created_at), '[]')
          from public.saved_places p where p.user_id = auth.uid() and p.deleted_at is null);
end $$;

-- Saving Home or Office replaces the previous one (the old row is soft-deleted).
create function api.save_place(
  p_kind text, p_name text, p_label text, p_subtitle text, p_lat double precision, p_lng double precision,
  p_driver_note text, p_suggest_mornings boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.saved_places;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_kind is null or p_kind not in ('home', 'office', 'other') or p_label is null or length(btrim(p_label)) = 0
     or p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or (p_kind = 'other' and (p_name is null or length(btrim(p_name)) = 0)) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"place","message":"Send a kind, a label and a valid position (and a name for other places)."}]}');
  end if;
  if (select count(*) from public.saved_places where user_id = auth.uid() and deleted_at is null) >= 20 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"place","message":"You can save up to 20 places."}]}');
  end if;
  if p_kind in ('home', 'office') then
    update public.saved_places set deleted_at = now(), updated_at = now()
    where user_id = auth.uid() and kind = p_kind and deleted_at is null;
  end if;
  insert into public.saved_places (user_id, kind, name, label, subtitle, point, driver_note, suggest_mornings)
  values (auth.uid(), p_kind, case when p_kind = 'other' then left(btrim(p_name), 40) end, left(btrim(p_label), 200),
          nullif(left(btrim(coalesce(p_subtitle, '')), 200), ''), private.point(p_lat, p_lng),
          nullif(left(btrim(coalesce(p_driver_note, '')), 300), ''), p_kind = 'office' and coalesce(p_suggest_mornings, false))
  returning * into v;
  return private.saved_place_json(v);
end $$;

create function api.remove_saved_place(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  update public.saved_places set deleted_at = now(), updated_at = now()
  where id = p_id and user_id = auth.uid() and deleted_at is null;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Trusted contacts (B7): up to three people a passenger can share trips with. Soft-deleted.
-- ---------------------------------------------------------------------------
create table public.trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  name text not null check (length(btrim(name)) between 1 and 60),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index uq_trusted_contacts_phone on public.trusted_contacts (user_id, phone) where deleted_at is null;
alter table public.trusted_contacts enable row level security;
alter table public.trusted_contacts force row level security;
revoke all on public.trusted_contacts from public, anon, authenticated;
create trigger trg_trusted_contacts_no_delete before delete on public.trusted_contacts
  for each row execute function private.forbid_delete();
create trigger trg_trusted_contacts_change_log after insert or update or delete on public.trusted_contacts
  for each row execute function audit.log_change();

create function api.list_trusted_contacts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone) order by c.created_at), '[]')
          from public.trusted_contacts c where c.user_id = auth.uid() and c.deleted_at is null);
end $$;

create function api.add_trusted_contact(p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.trusted_contacts;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 60 or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"contact","message":"Send a name and a phone number in +880… form."}]}');
  end if;
  if (select count(*) from public.trusted_contacts where user_id = auth.uid() and deleted_at is null) >= 3 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"contact","message":"You can keep up to 3 trusted contacts."}]}');
  end if;
  if exists (select 1 from public.trusted_contacts where user_id = auth.uid() and phone = p_phone and deleted_at is null) then
    perform private.raise_error('ALREADY_EXISTS');
  end if;
  insert into public.trusted_contacts (user_id, name, phone) values (auth.uid(), btrim(p_name), p_phone) returning * into v;
  return jsonb_build_object('id', v.id, 'name', v.name, 'phone', v.phone);
end $$;

create function api.remove_trusted_contact(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  update public.trusted_contacts set deleted_at = now() where id = p_id and user_id = auth.uid() and deleted_at is null;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Trip sharing (B5). The token is shown once; only its SHA-256 is stored. A link works while the trip is active and
-- for one hour after it ends. The public view has no phone numbers and no passenger identity.
-- ---------------------------------------------------------------------------
create function api.create_trip_share(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_token text;
begin
  perform private.require_role('passenger');
  select * into t from public.trips where id = p_trip_id and passenger_id = auth.uid() for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if t.status not in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', t.status));
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  update public.trips set share_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex') where id = t.id;
  return jsonb_build_object('token', v_token, 'trip_id', t.id);
end $$;

create function api.get_shared_trip(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then
    perform private.raise_error('NOT_FOUND');
  end if;
  select jsonb_build_object(
    'status', t.status,
    'pickup_label', r.pickup_label,
    'destination_label', r.destination_label,
    'destination', jsonb_build_object('lat', extensions.st_y(r.destination_point::extensions.geometry), 'lng', extensions.st_x(r.destination_point::extensions.geometry)),
    'driver_first_name', split_part(dp.full_name, ' ', 1),
    'vehicle', jsonb_build_object('registration_number', v.registration_number, 'make', v.make, 'model', v.model, 'color', v.color),
    'started_at', t.started_at, 'completed_at', t.completed_at,
    'driver_location', case when t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress') then (
        select jsonb_build_object('lat', extensions.st_y(l.location::extensions.geometry), 'lng', extensions.st_x(l.location::extensions.geometry),
                                  'heading', l.heading, 'updated_at', l.updated_at)
        from public.driver_live_locations l where l.driver_id = t.driver_id) end)
  into v
  from public.trips t
  join public.ride_requests r on r.id = t.request_id
  join public.driver_profiles d on d.id = t.driver_id
  join public.profiles dp on dp.id = d.user_id
  join public.vehicles v on v.id = t.vehicle_id
  where t.share_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and (t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress')
         or coalesce(t.completed_at, t.cancelled_at, t.updated_at) > now() - interval '1 hour');
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Current ride (B9): the passenger's open request or unfinished trip, or null.
-- ---------------------------------------------------------------------------
create function api.current_ride() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_role('passenger');
  select r.id into v_id from public.ride_requests r
  left join public.trips t on t.request_id = r.id
  where r.passenger_id = auth.uid()
    and (r.status in ('requested', 'searching')
         or (r.status = 'matched' and t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress')))
  order by r.requested_at desc limit 1;
  return case when v_id is null then null else api.get_ride(v_id) end;
end $$;

-- ---------------------------------------------------------------------------
-- Live category data (B11): with a point, each active category also returns how many eligible drivers are near and
-- the straight-line ETA of the nearest, using the same rules as dispatch candidate selection.
-- ---------------------------------------------------------------------------
create or replace function api.list_active_categories(p_lat double precision default null, p_lng double precision default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_point extensions.geography;
  v_radius numeric;
  v_speed numeric := coalesce((private.setting('dispatch.avg_speed_kmh'))::text::numeric, 25);
  v_stale numeric := coalesce((private.setting('location.stale_after_s'))::text::numeric, 120);
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_lat is not null then
    v_point := private.point(p_lat, p_lng);
    if private.zone_at(v_point) is null then
      perform private.raise_error('OUT_OF_SERVICE_AREA');
    end if;
    v_radius := coalesce((private.setting('dispatch.search_radius_m') ->> -1)::numeric, 5000);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'name', c.name, 'name_bn', c.name_bn, 'description', c.description,
      'passenger_capacity', c.passenger_capacity, 'icon', c.icon,
      'available_drivers', n.drivers,
      'pickup_eta_s', case when n.nearest_m is null then null else greatest(60, round(n.nearest_m / (v_speed / 3.6)))::int end
    ) order by c.sort_order, c.name)
    from public.vehicle_categories c
    left join lateral (
      select count(*)::int as drivers, min(extensions.st_distance(l.location, v_point)) as nearest_m
      from public.driver_live_locations l
      join public.driver_profiles d on d.id = l.driver_id
      join public.vehicles v on v.id = d.current_vehicle_id
      where v_point is not null and d.availability = 'online' and d.onboarding_status = 'approved'
        and v.status = 'active' and v.category_id = c.id
        and l.updated_at > now() - make_interval(secs => v_stale)
        and extensions.st_dwithin(l.location, v_point, v_radius)
    ) n on true
    where c.active
  ), '[]');
end $$;

-- ---------------------------------------------------------------------------
-- Push payloads (B2–B3)
-- ---------------------------------------------------------------------------
alter table public.notification_outbox add column data jsonb, add column category text;
alter table public.notification_outbox add constraint chk_outbox_data check (data is null or (jsonb_typeof(data) = 'object' and length(data::text) <= 2000));
alter table public.notification_outbox add constraint chk_outbox_category check (category is null or category in ('ride', 'support', 'safety', 'offers'));

create or replace function api.claim_notifications(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  perform private.require_service_role();
  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from public.notification_outbox
    where (status = 'queued' and next_attempt_at <= now()) or (status = 'sending' and next_attempt_at <= now() - interval '5 minutes')
    order by created_at limit least(greatest(coalesce(p_limit, 20), 1), 100) for update skip locked) q;
  update public.notification_outbox set status = 'sending', attempts = attempts + 1, next_attempt_at = now() where id = any (v_ids);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'channel', o.channel, 'to', o.to_address, 'subject', o.subject, 'body', o.body, 'link', o.link, 'attempts', o.attempts,
      'data', o.data, 'category', o.category,
      'tokens', case when o.channel = 'push' then (select coalesce(jsonb_agg(d.token), '[]') from public.push_devices d where d.user_id = o.recipient_id) end)
      order by o.created_at), '[]')
    from public.notification_outbox o where o.id = any (v_ids));
end $$;

-- The push worker removes tokens the push service reported as no longer registered.
create function api.forget_push_tokens(p_tokens text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform private.require_service_role();
  delete from public.push_devices where token = any (coalesce(p_tokens, '{}'));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Queues one push for a passenger (or any user) when they have a device and want this category.
create function private.enqueue_user_push(
  p_recipient uuid, p_category text, p_subject text, p_body text, p_link text, p_data jsonb, p_dedupe text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient is null or not private.wants_push(p_recipient, p_category)
     or not exists (select 1 from public.push_devices where user_id = p_recipient) then
    return;
  end if;
  insert into public.notification_outbox (channel, recipient_id, subject, body, link, data, category, dedupe_key)
  values ('push', p_recipient, left(p_subject, 200), left(p_body, 1000), p_link, p_data, p_category, p_dedupe)
  on conflict (dedupe_key, channel, recipient_id) where dedupe_key is not null do nothing;
end $$;

-- Passenger-facing copy in the passenger's language. Only the driver's first name and plate, nothing else personal.
create function private.passenger_push_text(p_kind text, p_lang text, p_driver text, p_plate text) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_lang = 'bn' then case p_kind
      when 'driver_assigned' then jsonb_build_object('title', 'চালক পাওয়া গেছে', 'body', coalesce(p_driver, 'আপনার চালক') || ' আসছেন · ' || coalesce(p_plate, ''))
      when 'arrived' then jsonb_build_object('title', 'আপনার চালক পৌঁছেছেন', 'body', coalesce(p_plate, '') || ' নম্বরপ্লেট মিলিয়ে নিন।')
      when 'in_progress' then jsonb_build_object('title', 'যাত্রা শুরু হয়েছে', 'body', 'নিরাপদ যাত্রা। SOS সবসময় এক চাপ দূরে।')
      when 'completed' then jsonb_build_object('title', 'আপনি পৌঁছেছেন', 'body', 'ভাড়া ও রসিদ দেখতে ট্যাপ করুন।')
      when 'cancelled' then jsonb_build_object('title', 'রাইড বাতিল হয়েছে', 'body', 'আপনার কাছ থেকে টাকা কাটা হয়নি। আবার বুক করতে ট্যাপ করুন।')
      when 'no_driver' then jsonb_build_object('title', 'এবার কোনো চালক পাওয়া যায়নি', 'body', 'কোনো টাকা কাটা হয়নি। আবার চেষ্টা করুন।')
      when 'support_reply' then jsonb_build_object('title', 'সাপোর্ট উত্তর দিয়েছে', 'body', 'আপনার অনুরোধে নতুন বার্তা।')
      when 'safety_update' then jsonb_build_object('title', 'নিরাপত্তা দল বিষয়টি দেখছে', 'body', 'আপনার SOS গ্রহণ করা হয়েছে।')
    end else case p_kind
      when 'driver_assigned' then jsonb_build_object('title', 'Driver found', 'body', coalesce(p_driver, 'Your driver') || ' is on the way · ' || coalesce(p_plate, ''))
      when 'arrived' then jsonb_build_object('title', 'Your driver is here', 'body', 'Check the plate ' || coalesce(p_plate, '') || ' before you get in.')
      when 'in_progress' then jsonb_build_object('title', 'Trip started', 'body', 'Have a safe ride. SOS is always one hold away.')
      when 'completed' then jsonb_build_object('title', 'You''ve arrived', 'body', 'Tap to see your fare and receipt.')
      when 'cancelled' then jsonb_build_object('title', 'Your ride was cancelled', 'body', 'You were not charged. Tap to book again.')
      when 'no_driver' then jsonb_build_object('title', 'No driver this time', 'body', 'Nothing was charged. Please try again.')
      when 'support_reply' then jsonb_build_object('title', 'Support replied', 'body', 'There''s a new message on your request.')
      when 'safety_update' then jsonb_build_object('title', 'Our safety team is on it', 'body', 'Your SOS has been acknowledged.')
    end end;
$$;

create function private.on_trip_status_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_type text;
  v_lang text;
  v_driver text;
  v_plate text;
  v_text jsonb;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;
  v_kind := case new.status
    when 'driver_assigned' then 'driver_assigned'
    when 'arrived' then 'arrived'
    when 'in_progress' then 'in_progress'
    when 'completed' then 'completed'
    when 'cancelled_by_driver' then 'cancelled'
    when 'cancelled_by_admin' then 'cancelled'
    when 'failed' then 'cancelled'
  end;
  if v_kind is null then
    return new;
  end if;
  v_type := case v_kind when 'driver_assigned' then 'ride.driver_assigned' when 'arrived' then 'ride.driver_arrived'
    when 'in_progress' then 'ride.started' when 'completed' then 'ride.completed' else 'ride.cancelled' end;
  select p.preferred_language into v_lang from public.profiles p where p.id = new.passenger_id;
  select split_part(dp.full_name, ' ', 1), v.registration_number into v_driver, v_plate
  from public.driver_profiles d join public.profiles dp on dp.id = d.user_id join public.vehicles v on v.id = new.vehicle_id
  where d.id = new.driver_id;
  v_text := private.passenger_push_text(v_kind, v_lang, v_driver, v_plate);
  perform private.enqueue_user_push(new.passenger_id, 'ride', v_text ->> 'title', v_text ->> 'body',
    case when v_kind = 'completed' then '/complete/' || new.request_id else '/ride/' || new.request_id end,
    jsonb_build_object('type', v_type, 'ride_id', new.request_id, 'trip_id', new.id),
    'trip:' || new.id || ':' || new.status);
  return new;
end $$;

create trigger trg_trips_passenger_push after insert or update of status on public.trips
  for each row execute function private.on_trip_status_push();

create function private.on_request_status_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_text jsonb;
begin
  if new.status = 'no_driver_found' and old.status is distinct from new.status then
    v_text := private.passenger_push_text('no_driver', (select preferred_language from public.profiles where id = new.passenger_id), null, null);
    perform private.enqueue_user_push(new.passenger_id, 'ride', v_text ->> 'title', v_text ->> 'body', '/ride/' || new.id,
      jsonb_build_object('type', 'ride.no_driver', 'ride_id', new.id), 'request:' || new.id || ':no_driver');
  end if;
  return new;
end $$;

create trigger trg_requests_passenger_push after update of status on public.ride_requests
  for each row execute function private.on_request_status_push();

create function private.on_ticket_reply_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
  v_text jsonb;
begin
  if new.author_type <> 'admin' or new.is_internal then
    return new;
  end if;
  select * into t from public.support_tickets where id = new.ticket_id;
  v_text := private.passenger_push_text('support_reply', (select preferred_language from public.profiles where id = t.requester_id), null, null);
  perform private.enqueue_user_push(t.requester_id, 'support', v_text ->> 'title', v_text ->> 'body', '/support/' || t.id,
    jsonb_build_object('type', 'support.reply', 'ticket_id', t.id), 'ticket-message:' || new.id);
  return new;
end $$;

create trigger trg_ticket_messages_push after insert on public.support_ticket_messages
  for each row execute function private.on_ticket_reply_push();

create function private.on_incident_ack_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_text jsonb;
begin
  if new.status = 'acknowledged' and old.status is distinct from new.status then
    v_text := private.passenger_push_text('safety_update', (select preferred_language from public.profiles where id = new.reporter_id), null, null);
    perform private.enqueue_user_push(new.reporter_id, 'safety', v_text ->> 'title', v_text ->> 'body', '/safety',
      jsonb_build_object('type', 'safety.update'), 'incident:' || new.id || ':acknowledged');
  end if;
  return new;
end $$;

create trigger trg_incidents_push after update of status on public.safety_incidents
  for each row execute function private.on_incident_ack_push();

-- ---------------------------------------------------------------------------
-- Grants: callers only reach these through the API routes.
-- ---------------------------------------------------------------------------
revoke execute on function
  api.record_consent(text), api.get_notification_preferences(), api.set_notification_preferences(boolean, boolean, boolean),
  api.list_saved_places(), api.save_place(text, text, text, text, double precision, double precision, text, boolean), api.remove_saved_place(uuid),
  api.list_trusted_contacts(), api.add_trusted_contact(text, text), api.remove_trusted_contact(uuid),
  api.create_trip_share(uuid), api.get_shared_trip(text), api.current_ride(), api.list_active_categories(double precision, double precision),
  api.forget_push_tokens(text[]), api.claim_notifications(integer)
from public, anon;
grant execute on function
  api.record_consent(text), api.get_notification_preferences(), api.set_notification_preferences(boolean, boolean, boolean),
  api.list_saved_places(), api.save_place(text, text, text, text, double precision, double precision, text, boolean), api.remove_saved_place(uuid),
  api.list_trusted_contacts(), api.add_trusted_contact(text, text), api.remove_trusted_contact(uuid),
  api.create_trip_share(uuid), api.current_ride(), api.list_active_categories(double precision, double precision)
to authenticated;
-- The public share page reads through the server (secret key, purpose "share.read"): anonymous callers never reach
-- the api schema directly.
grant execute on function api.get_shared_trip(text) to service_role;
revoke execute on function api.claim_notifications(integer), api.forget_push_tokens(text[]) from authenticated;
grant execute on function api.claim_notifications(integer), api.forget_push_tokens(text[]) to service_role;
revoke execute on function
  private.wants_push(uuid, text), private.enqueue_user_push(uuid, text, text, text, text, jsonb, text),
  private.passenger_push_text(text, text, text, text), private.saved_place_json(public.saved_places)
from public, anon, authenticated;
revoke execute on function private.on_trip_status_push(), private.on_request_status_push(), private.on_ticket_reply_push(), private.on_incident_ack_push() from public, anon, authenticated;
