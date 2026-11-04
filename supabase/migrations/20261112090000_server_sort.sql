-- Server-side sorting for every paginated admin list, keeping keyset (cursor) pagination.
--
-- Each list RPC gains a trailing `p_sort text default null`: a whitelisted key with an optional leading `-` for
-- descending (e.g. `-created_at`, `full_name`). Null keeps the previous default order exactly.
--
-- Pattern (static SQL, no dynamic SQL): every candidate row carries three typed sort slots (k_ts timestamptz,
-- k_num numeric, k_txt text); the chosen key fills one of them and the others hold constants. Nulls are coalesced
-- to a sentinel so they sort consistently (lowest). Rows are ordered by (k_ts, k_num, k_txt, id) in one direction
-- and the keyset is a row comparison on the same tuple. The cursor is an opaque base64url JSON array of that tuple;
-- the old "<ts>|<id>" cursor is still accepted (it maps onto the default key).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.parse_sort(p_sort text, p_allowed text[], p_default text, out sort_key text, out descending boolean)
language plpgsql stable set search_path = '' as $$
declare
  v text := coalesce(nullif(btrim(p_sort), ''), p_default);
begin
  descending := left(v, 1) = '-';
  sort_key := case when descending then substr(v, 2) else v end;
  if not (sort_key = any (p_allowed)) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"sort","message":"Unknown sort key."}]}');
  end if;
end $$;

create function private.sort_cursor(p_ts timestamptz, p_num numeric, p_txt text, p_id text) returns text
language sql immutable set search_path = '' as $$
  select rtrim(translate(encode(convert_to(jsonb_build_array(p_ts, p_num, p_txt, p_id)::text, 'UTF8'), 'base64'),
    E'+/\n', '-_'), '=');
$$;

create function private.parse_sort_cursor(p_cursor text, out ts timestamptz, out num numeric, out txt text, out id text)
language plpgsql stable set search_path = '' as $$
declare
  v_b64 text;
  v_json jsonb;
begin
  if p_cursor is null then
    return;
  end if;
  begin
    if position('|' in p_cursor) > 0 then
      -- Legacy "<ts>|<id>" cursor from before server sorting (default key only).
      ts := split_part(p_cursor, '|', 1)::timestamptz;
      num := 0;
      txt := '';
      id := split_part(p_cursor, '|', 2);
    else
      v_b64 := translate(p_cursor, '-_', '+/');
      v_b64 := v_b64 || repeat('=', (4 - length(v_b64) % 4) % 4);
      v_json := convert_from(decode(v_b64, 'base64'), 'UTF8')::jsonb;
      ts := (v_json ->> 0)::timestamptz;
      num := (v_json ->> 1)::numeric;
      txt := v_json ->> 2;
      id := v_json ->> 3;
    end if;
  exception when others then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"cursor","message":"Invalid cursor."}]}');
  end;
  if ts is null or num is null or txt is null or id is null then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"cursor","message":"Invalid cursor."}]}');
  end if;
end $$;

-- Rows carry their own cursor under "_cursor"; strip it and expose the last visible row's as next_cursor.
create function private.page_sorted(p_rows jsonb, p_limit integer) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(e.r - '_cursor' order by e.n), '[]') from jsonb_array_elements(p_rows) with ordinality e(r, n) where e.n <= p_limit),
    'next_cursor', case when jsonb_array_length(p_rows) > p_limit then p_rows -> (p_limit - 1) ->> '_cursor' end);
$$;

revoke execute on function private.parse_sort(text, text[], text) from public, anon, authenticated;
revoke execute on function private.sort_cursor(timestamptz, numeric, text, text) from public, anon, authenticated;
revoke execute on function private.parse_sort_cursor(text) from public, anon, authenticated;
revoke execute on function private.page_sorted(jsonb, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Passengers: full_name, status, created_at, last_seen_at
-- ---------------------------------------------------------------------------
drop function api.list_passengers(text, text, integer, text);
create function api.list_passengers(
  p_status text default null, p_search text default null, p_limit integer default 50, p_cursor text default null,
  p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('passengers.view');
  if p_status is not null and p_status not in ('active', 'suspended', 'deactivated') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['full_name', 'status', 'created_at', 'last_seen_at'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(private.passenger_json(x.id) || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select p.id,
        coalesce(case v_key when 'created_at' then p.created_at when 'last_seen_at' then p.last_seen_at end, '-infinity') as k_ts,
        0::numeric as k_num,
        coalesce(case v_key when 'full_name' then p.full_name when 'status' then p.status::text end, '') as k_txt
      from public.profiles p
      where p.role in ('passenger', 'user') and p.deleted_at is null
        and (p_status is null or p.status::text = p_status)
        and (v_search is null or p.full_name ilike '%' || v_search || '%'
             or (v_digits is not null and length(v_digits) >= 3 and right(p.phone, length(v_digits)) = v_digits))
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit);
end $$;

-- ---------------------------------------------------------------------------
-- Drivers: full_name, status (onboarding), rating, submitted_at, created_at
-- ---------------------------------------------------------------------------
drop function api.list_drivers(text, text, integer, text);
create function api.list_drivers(
  p_tab text default 'all', p_search text default null, p_limit integer default 50, p_cursor text default null,
  p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('drivers.view');
  if p_tab not in ('all', 'applications', 'approved', 'suspended', 'rejected', 'draft') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"tab","message":"Unknown tab."}]}');
  end if;
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['full_name', 'status', 'rating', 'submitted_at', 'created_at'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(private.driver_row_json(x.id) || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select d.id,
        coalesce(case v_key when 'created_at' then d.created_at when 'submitted_at' then d.submitted_at end, '-infinity') as k_ts,
        coalesce(case v_key when 'rating' then d.rating_avg end, 0)::numeric as k_num,
        coalesce(case v_key when 'full_name' then p.full_name when 'status' then d.onboarding_status::text end, '') as k_txt
      from public.driver_profiles d
      join public.profiles p on p.id = d.user_id
      left join public.vehicles v on v.id = d.current_vehicle_id
      where (p_tab = 'all'
          or (p_tab = 'applications' and d.onboarding_status in ('submitted', 'under_review'))
          or (p_tab = 'approved' and d.onboarding_status = 'approved')
          or (p_tab = 'suspended' and d.onboarding_status = 'suspended')
          or (p_tab = 'rejected' and d.onboarding_status = 'rejected')
          or (p_tab = 'draft' and d.onboarding_status = 'draft'))
        and (v_search is null
          or p.full_name ilike '%' || v_search || '%'
          or (v_digits is not null and length(v_digits) >= 3 and right(p.phone, length(v_digits)) = v_digits)
          or v.registration_number ilike '%' || upper(v_search) || '%')
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit) || jsonb_build_object(
    'counts', (select jsonb_build_object(
      'applications', count(*) filter (where onboarding_status in ('submitted', 'under_review')),
      'approved', count(*) filter (where onboarding_status = 'approved'),
      'suspended', count(*) filter (where onboarding_status = 'suspended'),
      'online', count(*) filter (where availability <> 'offline'))
      from public.driver_profiles)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Vehicles: registration_number, status, verified_at, created_at
-- ---------------------------------------------------------------------------
drop function api.list_vehicles(text, text, integer, text);
create function api.list_vehicles(
  p_status text default null, p_search text default null, p_limit integer default 50, p_cursor text default null,
  p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('vehicles.view');
  if p_status is not null and p_status not in ('pending', 'active', 'inactive', 'suspended') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['registration_number', 'driver_name', 'status', 'verified_at', 'created_at'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(private.vehicle_json(x.id) || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select v.id,
        coalesce(case v_key when 'created_at' then v.created_at when 'verified_at' then v.verified_at end, '-infinity') as k_ts,
        0::numeric as k_num,
        coalesce(case v_key when 'registration_number' then v.registration_number when 'driver_name' then p.full_name
                            when 'status' then v.status::text end, '') as k_txt
      from public.vehicles v
      join public.driver_profiles d on d.id = v.driver_id
      join public.profiles p on p.id = d.user_id
      where (p_status is null or v.status::text = p_status)
        and (v_search is null or v.registration_number ilike '%' || upper(v_search) || '%'
             or p.full_name ilike '%' || v_search || '%' or (v.make || ' ' || v.model) ilike '%' || v_search || '%')
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit);
end $$;

-- ---------------------------------------------------------------------------
-- Document queue: queue_date (the queue's own date), driver_name, document_type, uploaded_at, expires_at
-- Default: queue_date ascending for pending/expiring (SLA), descending otherwise.
-- ---------------------------------------------------------------------------
drop function api.list_document_queue(text, integer, text);
create function api.list_document_queue(p_queue text, p_limit integer default 50, p_cursor text default null, p_sort text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_warn integer := coalesce((private.setting('documents.expiry_warning_days'))::int, 30);
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('documents.view');
  if p_queue not in ('pending', 'expiring', 'expired', 'rejected') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"queue","message":"Unknown queue."}]}');
  end if;
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['queue_date', 'driver_name', 'document_type', 'uploaded_at', 'expires_at'],
    case when p_queue in ('pending', 'expiring') then 'queue_date' else '-queue_date' end) s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(x.r || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select d.id, jsonb_build_object(
        'id', d.id, 'driver_id', d.driver_id, 'driver_name', p.full_name, 'document_type', d.document_type,
        'vehicle', case when v.id is null then null else jsonb_build_object('id', v.id, 'registration_number', v.registration_number) end,
        'review_status', d.review_status, 'uploaded_at', d.uploaded_at, 'expires_at', d.expires_at,
        'rejection_reason', d.rejection_reason, 'onboarding_status', dp.onboarding_status
      ) as r,
        coalesce(case v_key
          when 'queue_date' then case p_queue
            when 'pending' then d.uploaded_at
            when 'expiring' then d.expires_at::timestamptz
            when 'expired' then d.expires_at::timestamptz
            else d.reviewed_at end
          when 'uploaded_at' then d.uploaded_at
          when 'expires_at' then d.expires_at::timestamptz end, '-infinity') as k_ts,
        0::numeric as k_num,
        coalesce(case v_key when 'driver_name' then p.full_name when 'document_type' then d.document_type::text end, '') as k_txt
      from public.driver_documents d
      join public.driver_profiles dp on dp.id = d.driver_id
      join public.profiles p on p.id = dp.user_id
      left join public.vehicles v on v.id = d.vehicle_id
      where d.uploaded_at is not null and d.superseded_at is null
        and case p_queue
          when 'pending' then d.review_status = 'pending'
          when 'expiring' then d.review_status = 'approved' and d.expires_at between current_date and current_date + v_warn
          when 'expired' then d.review_status = 'expired'
                               or (d.review_status = 'approved' and d.expires_at < current_date)
          else d.review_status = 'rejected' end
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit) || jsonb_build_object(
    'counts', (select jsonb_build_object(
      'pending', count(*) filter (where review_status = 'pending'),
      'expiring', count(*) filter (where review_status = 'approved' and expires_at between current_date and current_date + v_warn),
      'expired', count(*) filter (where review_status = 'expired' or (review_status = 'approved' and expires_at < current_date)))
      from public.driver_documents where uploaded_at is not null and superseded_at is null)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Trips: created_at, accepted_at, status, fare, distance, passenger_name
-- ---------------------------------------------------------------------------
drop function api.list_trips(text, text, boolean, integer, text);
create function api.list_trips(
  p_status text default null, p_search text default null, p_flagged boolean default false,
  p_limit integer default 50, p_cursor text default null, p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('trips.view');
  if p_status is not null and p_status not in ('active', 'cancelled', 'driver_assigned', 'driver_arriving', 'arrived', 'in_progress', 'completed',
      'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['created_at', 'accepted_at', 'status', 'fare', 'distance', 'passenger_name', 'driver_name'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(private.trip_row_json(x.id) || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select t.id,
        coalesce(case v_key when 'created_at' then t.created_at when 'accepted_at' then t.accepted_at end, '-infinity') as k_ts,
        coalesce(case v_key when 'fare' then t.final_fare when 'distance' then t.actual_distance_m end, 0)::numeric as k_num,
        coalesce(case v_key when 'status' then t.status::text when 'passenger_name' then pp.full_name
                            when 'driver_name' then dp.full_name end, '') as k_txt
      from public.trips t
      join public.profiles pp on pp.id = t.passenger_id
      join public.driver_profiles d on d.id = t.driver_id join public.profiles dp on dp.id = d.user_id
      join public.vehicles v on v.id = t.vehicle_id
      where (p_status is null
             or (p_status = 'active' and t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress'))
             or (p_status = 'cancelled' and t.status in ('cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed'))
             or t.status::text = p_status)
        and (not coalesce(p_flagged, false) or t.fare_review_required)
        and (v_search is null or pp.full_name ilike '%' || v_search || '%' or dp.full_name ilike '%' || v_search || '%'
             or v.registration_number ilike '%' || upper(v_search) || '%' or t.id::text like lower(v_search) || '%')
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit) || jsonb_build_object(
    'counts', (select jsonb_build_object(
      'active', count(*) filter (where status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress')),
      'flagged', count(*) filter (where fare_review_required and created_at > now() - interval '7 days'))
      from public.trips));
end $$;

-- ---------------------------------------------------------------------------
-- Ride requests: requested_at, status, estimated_fare, passenger_name
-- ---------------------------------------------------------------------------
drop function api.list_ride_requests(text, text, integer, text);
create function api.list_ride_requests(
  p_status text default null, p_search text default null, p_limit integer default 50, p_cursor text default null,
  p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('trips.view');
  if p_status is not null and p_status not in ('searching', 'matched', 'no_driver_found', 'cancelled_by_passenger',
      'cancelled_by_driver', 'cancelled_by_admin', 'failed', 'completed') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['requested_at', 'status', 'estimated_fare', 'passenger_name'], '-requested_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(private.request_row_json(x.id) || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select r.id,
        coalesce(case v_key when 'requested_at' then r.requested_at end, '-infinity') as k_ts,
        coalesce(case v_key when 'estimated_fare' then r.estimated_fare end, 0)::numeric as k_num,
        coalesce(case v_key when 'status' then r.status::text when 'passenger_name' then p.full_name end, '') as k_txt
      from public.ride_requests r join public.profiles p on p.id = r.passenger_id
      where (p_status is null or r.status::text = p_status)
        and (v_search is null or p.full_name ilike '%' || v_search || '%' or r.id::text like lower(v_search) || '%')
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit);
end $$;

-- ---------------------------------------------------------------------------
-- Payments: created_at, amount, status, method, passenger_name
-- ---------------------------------------------------------------------------
drop function api.list_payments(text, text, boolean, text, integer, text);
create function api.list_payments(
  p_status text default null, p_method text default null, p_unreconciled boolean default false, p_search text default null,
  p_limit integer default 50, p_cursor text default null, p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_grace integer := coalesce((private.setting('payments.cash_collection_grace_h'))::int, 24);
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('payments.view');
  if p_status is not null and p_status not in ('pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'overdue') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['created_at', 'amount', 'status', 'method', 'passenger_name'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(private.payment_row_json(x.rec) || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select p.id, p as rec,
        coalesce(case v_key when 'created_at' then p.created_at end, '-infinity') as k_ts,
        coalesce(case v_key when 'amount' then p.amount end, 0)::numeric as k_num,
        coalesce(case v_key when 'status' then p.status::text when 'method' then p.method::text
                            when 'passenger_name' then pp.full_name end, '') as k_txt
      from public.payments p
      join public.profiles pp on pp.id = p.passenger_id
      join public.driver_profiles d on d.id = p.driver_id join public.profiles dp on dp.id = d.user_id
      where (p_status is null or (p_status = 'overdue' and p.status = 'pending' and p.created_at < now() - make_interval(hours => v_grace)) or p.status::text = p_status)
        and (p_method is null or p.method::text = p_method)
        and (not coalesce(p_unreconciled, false) or (p.status in ('succeeded', 'partially_refunded', 'refunded') and p.reconciled_at is null))
        and (v_search is null or pp.full_name ilike '%' || v_search || '%' or dp.full_name ilike '%' || v_search || '%' or p.trip_id::text like lower(v_search) || '%')
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit) || jsonb_build_object('counts', (
    select jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'overdue', count(*) filter (where status = 'pending' and created_at < now() - make_interval(hours => v_grace)),
      'unreconciled', count(*) filter (where status in ('succeeded', 'partially_refunded', 'refunded') and reconciled_at is null),
      'unreconciled_amount', coalesce(sum(amount) filter (where status in ('succeeded', 'partially_refunded', 'refunded') and reconciled_at is null), 0))
    from public.payments));
end $$;

-- ---------------------------------------------------------------------------
-- Support tickets: created_at, updated_at, sla_due_at, priority (enum order), status, ticket_no
-- ---------------------------------------------------------------------------
drop function api.list_tickets(text, text, text, text, integer, text);
create function api.list_tickets(
  p_status text default null, p_priority text default null, p_assignee text default null, p_search text default null,
  p_limit integer default 50, p_cursor text default null, p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('support.view');
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['created_at', 'updated_at', 'sla_due_at', 'priority', 'status', 'ticket_no'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(private.ticket_row_json(x.rec) || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select t.id, t as rec,
        coalesce(case v_key when 'created_at' then t.created_at when 'updated_at' then t.updated_at
                            when 'sla_due_at' then t.sla_due_at end, '-infinity') as k_ts,
        coalesce(case v_key when 'priority' then array_position(enum_range(t.priority), t.priority)
                            when 'ticket_no' then t.ticket_no end, 0)::numeric as k_num,
        coalesce(case v_key when 'status' then t.status::text end, '') as k_txt
      from public.support_tickets t
      where (p_status is null or (p_status = 'active' and t.status in ('open', 'in_progress', 'pending_user')) or t.status::text = p_status)
        and (p_priority is null or t.priority::text = p_priority)
        and (p_assignee is null or (p_assignee = 'me' and t.assignee_id = auth.uid()) or (p_assignee = 'unassigned' and t.assignee_id is null))
        and (v_search is null or t.subject ilike '%' || v_search || '%' or t.ticket_no::text = ltrim(v_search, '#'))
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit) || jsonb_build_object('counts', (
    select jsonb_build_object(
      'active', count(*) filter (where status in ('open', 'in_progress', 'pending_user')),
      'unassigned', count(*) filter (where status in ('open', 'in_progress') and assignee_id is null),
      'breached', count(*) filter (where status in ('open', 'in_progress') and sla_due_at < now() and first_response_at is null),
      'mine', count(*) filter (where status in ('open', 'in_progress', 'pending_user') and assignee_id = auth.uid()))
    from public.support_tickets));
end $$;

-- ---------------------------------------------------------------------------
-- Ratings: created_at, score
-- ---------------------------------------------------------------------------
drop function api.list_ratings(integer, boolean, integer, text);
create function api.list_ratings(
  p_max_score integer default null, p_hidden boolean default false, p_limit integer default 50, p_cursor text default null,
  p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('support.view');
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['created_at', 'score'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'trip_id', x.trip_id, 'score', x.score, 'comment', x.comment, 'reviewer_role', x.reviewer_role,
      'reviewer_name', (select full_name from public.profiles p where p.id = x.reviewer_id),
      'reviewee_name', (select full_name from public.profiles p where p.id = x.reviewee_id),
      'hidden', x.hidden_at is not null, 'hidden_reason', x.hidden_reason, 'created_at', x.created_at,
      '_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select r.*,
        coalesce(case v_key when 'created_at' then r.created_at end, '-infinity') as k_ts,
        coalesce(case v_key when 'score' then r.score end, 0)::numeric as k_num,
        ''::text as k_txt
      from public.ratings r
      where (p_max_score is null or r.score <= p_max_score) and ((r.hidden_at is not null) = coalesce(p_hidden, false))
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit);
end $$;

-- ---------------------------------------------------------------------------
-- Safety incidents: created_at, reported_at, severity (enum order), status
-- ---------------------------------------------------------------------------
drop function api.list_incidents(text, integer, text);
create function api.list_incidents(p_status text default 'open', p_limit integer default 50, p_cursor text default null, p_sort text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('safety.view');
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['created_at', 'reported_at', 'severity', 'status'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(private.incident_row_json(x.rec) || jsonb_build_object('_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select i.id, i as rec,
        coalesce(case v_key when 'created_at' then i.created_at when 'reported_at' then i.reported_at end, '-infinity') as k_ts,
        coalesce(case v_key when 'severity' then array_position(enum_range(i.severity), i.severity) end, 0)::numeric as k_num,
        coalesce(case v_key when 'status' then i.status::text end, '') as k_txt
      from public.safety_incidents i
      where (p_status is null or (p_status = 'open' and i.status not in ('resolved', 'closed')) or (p_status = 'done' and i.status in ('resolved', 'closed')) or i.status::text = p_status)
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit) || jsonb_build_object('counts', (
    select jsonb_build_object(
      'open', count(*) filter (where status not in ('resolved', 'closed')),
      'unacknowledged', count(*) filter (where status = 'reported'),
      'critical', count(*) filter (where status not in ('resolved', 'closed') and severity = 'critical'))
    from public.safety_incidents));
end $$;

-- ---------------------------------------------------------------------------
-- Ledger transactions: created_at, kind, amount
-- ---------------------------------------------------------------------------
drop function api.list_ledger_transactions(text, uuid, integer, text);
create function api.list_ledger_transactions(
  p_kind text default null, p_trip_id uuid default null, p_limit integer default 50, p_cursor text default null,
  p_sort text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_key text;
  v_desc boolean;
  c record;
  v_rows jsonb;
begin
  perform private.require_permission('ledger.view');
  select s.sort_key, s.descending into v_key, v_desc
  from private.parse_sort(p_sort, array['created_at', 'kind', 'amount'], '-created_at') s;
  select * into c from private.parse_sort_cursor(p_cursor);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'kind', x.kind, 'reference', x.reference, 'trip_id', x.trip_id, 'memo', x.memo, 'created_at', x.created_at,
      'reverses_id', x.reverses_id, 'reversed', exists (select 1 from public.ledger_transactions r where r.reverses_id = x.id),
      'amount', x.amount,
      '_cursor', private.sort_cursor(x.k_ts, x.k_num, x.k_txt, x.id::text))
    order by case when v_desc then x.k_ts end desc, case when v_desc then x.k_num end desc, case when v_desc then x.k_txt end desc,
             case when v_desc then x.id end desc, x.k_ts, x.k_num, x.k_txt, x.id), '[]') into v_rows
  from (
    select q.* from (
      select a.*,
        coalesce(case v_key when 'created_at' then a.created_at end, '-infinity') as k_ts,
        coalesce(case v_key when 'amount' then a.amount end, 0)::numeric as k_num,
        coalesce(case v_key when 'kind' then a.kind::text end, '') as k_txt
      from (
        select t.id, t.kind, t.reference, t.trip_id, t.memo, t.created_at, t.reverses_id,
          (select coalesce(sum(e.debit), 0) from public.ledger_entries e where e.transaction_id = t.id) as amount
        from public.ledger_transactions t
        where (p_kind is null or t.kind = p_kind) and (p_trip_id is null or t.trip_id = p_trip_id)
      ) a
    ) q
    where p_cursor is null
       or (v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) < (c.ts, c.num, c.txt, c.id::uuid))
       or (not v_desc and (q.k_ts, q.k_num, q.k_txt, q.id) > (c.ts, c.num, c.txt, c.id::uuid))
    order by case when v_desc then q.k_ts end desc, case when v_desc then q.k_num end desc, case when v_desc then q.k_txt end desc,
             case when v_desc then q.id end desc, q.k_ts, q.k_num, q.k_txt, q.id
    limit v_limit + 1
  ) x;

  return private.page_sorted(v_rows, v_limit);
end $$;

-- ---------------------------------------------------------------------------
-- Grants (same posture as before: authenticated only; permission checks inside)
-- ---------------------------------------------------------------------------
revoke execute on function
  api.list_passengers(text, text, integer, text, text),
  api.list_drivers(text, text, integer, text, text),
  api.list_vehicles(text, text, integer, text, text),
  api.list_document_queue(text, integer, text, text),
  api.list_trips(text, text, boolean, integer, text, text),
  api.list_ride_requests(text, text, integer, text, text),
  api.list_payments(text, text, boolean, text, integer, text, text),
  api.list_tickets(text, text, text, text, integer, text, text),
  api.list_ratings(integer, boolean, integer, text, text),
  api.list_incidents(text, integer, text, text),
  api.list_ledger_transactions(text, uuid, integer, text, text)
from public, anon;
grant execute on function
  api.list_passengers(text, text, integer, text, text),
  api.list_drivers(text, text, integer, text, text),
  api.list_vehicles(text, text, integer, text, text),
  api.list_document_queue(text, integer, text, text),
  api.list_trips(text, text, boolean, integer, text, text),
  api.list_ride_requests(text, text, integer, text, text),
  api.list_payments(text, text, boolean, text, integer, text, text),
  api.list_tickets(text, text, text, text, integer, text, text),
  api.list_ratings(integer, boolean, integer, text, text),
  api.list_incidents(text, integer, text, text),
  api.list_ledger_transactions(text, uuid, integer, text, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Archive export reads: keyset by ctid instead of OFFSET.
-- p_after is the previous chunk's last ctid packed as (block << 16) | line pointer (null for the first chunk).
-- Returns {"rows": [...], "next_after": <bigint or null>}.
-- ---------------------------------------------------------------------------
drop function api.read_archive_chunk(bigint, bigint, integer);
create function api.read_archive_chunk(p_run_id bigint, p_after bigint default null, p_limit integer default 1000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_after tid := case when p_after is null then '(0,0)'::tid
                      else format('(%s,%s)', p_after >> 16, p_after & 65535)::tid end;
  v_rows jsonb;
  v_last tid;
  v_count integer;
begin
  perform private.require_service_role();
  select partition_name into v_name from public.archive_runs where id = p_run_id and kind = 'partition';
  if v_name is null or to_regclass(format('archive.%I', v_name)) is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t) - ''_ctid'' order by t._ctid), ''[]''), max(t._ctid), count(*)::int
                  from (select a.*, a.ctid as _ctid from archive.%I a where a.ctid > $1 order by a.ctid limit $2) t', v_name)
    into v_rows, v_last, v_count using v_after, v_limit;
  return jsonb_build_object('rows', v_rows,
    'next_after', case when v_count = v_limit then
      ((v_last::text::point)[0]::bigint << 16) | (v_last::text::point)[1]::bigint end);
end $$;

revoke execute on function api.read_archive_chunk(bigint, bigint, integer) from public, anon, authenticated;
grant execute on function api.read_archive_chunk(bigint, bigint, integer) to service_role;
