-- Driver app backend gaps (rider-driver docs/spec/04-integration.md §9–§10):
--   1. Push to drivers: new offer, trip cancelled by the passenger or ops, forced offline, application decisions.
--      Categories are prefixed "driver." so the push sender maps them to the driver app's Android channels and never
--      to the passenger promotions channel.
--   2. Realtime `availability_changed` on driver:{id} whenever availability or application status changes, so the
--      app follows a forced offline or a suspension at once.
--   3. Offer timeout and no-show wait in api.client_config(), so the app stops hard-coding them.
--   4. api.driver_trips(): the driver's trips (completed and cancelled), newest first, keyset-paged.

-- ---------------------------------------------------------------------------
-- 1. Driver push copy
-- ---------------------------------------------------------------------------
alter table public.notification_outbox drop constraint chk_outbox_category;
alter table public.notification_outbox add constraint chk_outbox_category check (
  category is null or category in ('ride', 'support', 'safety', 'offers',
                                   'driver.offers', 'driver.trip', 'driver.account', 'driver.money', 'driver.support'));

create function private.driver_push_text(p_kind text, p_lang text, p_amount text default null, p_reason text default null) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_lang = 'bn' then case p_kind
      when 'offer' then jsonb_build_object('title', 'নতুন ট্রিপ অফার', 'body', coalesce('৳' || p_amount || ' · ', '') || 'গ্রহণ করতে দ্রুত ট্যাপ করুন।')
      when 'trip_cancelled' then jsonb_build_object('title', 'ট্রিপ বাতিল হয়েছে', 'body', 'যাত্রী বা রাইডার টিম ট্রিপটি বাতিল করেছে।')
      when 'forced_offline' then jsonb_build_object('title', 'আপনি এখন অফলাইন', 'body', coalesce(p_reason, 'আবার অফার পেতে অ্যাপ খুলে অনলাইন হন।'))
      when 'approved' then jsonb_build_object('title', 'আপনার আবেদন অনুমোদিত', 'body', 'অনলাইন হয়ে আয় শুরু করুন।')
      when 'rejected' then jsonb_build_object('title', 'আবেদনে সংশোধন দরকার', 'body', 'কী ঠিক করতে হবে দেখতে ট্যাপ করুন।')
      when 'suspended' then jsonb_build_object('title', 'অ্যাকাউন্ট স্থগিত', 'body', 'বিস্তারিত জানতে সাপোর্টে যোগাযোগ করুন।')
    end else case p_kind
      when 'offer' then jsonb_build_object('title', 'New trip offer', 'body', coalesce('৳' || p_amount || ' · ', '') || 'Tap quickly to accept.')
      when 'trip_cancelled' then jsonb_build_object('title', 'Trip cancelled', 'body', 'The passenger or the Rider team cancelled this trip.')
      when 'forced_offline' then jsonb_build_object('title', 'You are offline now', 'body', coalesce(p_reason, 'Open the app and go online to get offers again.'))
      when 'approved' then jsonb_build_object('title', 'Your application is approved', 'body', 'Go online and start earning.')
      when 'rejected' then jsonb_build_object('title', 'Your application needs changes', 'body', 'Tap to see what to fix.')
      when 'suspended' then jsonb_build_object('title', 'Account suspended', 'body', 'Contact support for details.')
    end end;
$$;

create function private.driver_user(p_driver_id uuid, out user_id uuid, out lang text)
language sql stable security definer set search_path = '' as $$
  select d.user_id, p.preferred_language::text from public.driver_profiles d join public.profiles p on p.id = d.user_id where d.id = p_driver_id;
$$;

-- New offer: the realtime event already exists; the push reaches a phone whose app is closed or asleep.
create function private.on_offer_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_lang text;
  v_amount text;
  v_text jsonb;
begin
  select u.user_id, u.lang into v_user, v_lang from private.driver_user(new.driver_id) u;
  select r.estimated_fare::text into v_amount from public.ride_requests r where r.id = new.request_id;
  v_text := private.driver_push_text('offer', v_lang, v_amount);
  perform private.enqueue_user_push(v_user, 'driver.offers', v_text ->> 'title', v_text ->> 'body', '/offer',
    jsonb_build_object('type', 'offer.created', 'offer_id', new.id, 'expires_at', new.expires_at), 'offer:' || new.id);
  return new;
end $$;

create trigger trg_dispatch_offers_driver_push after insert on public.dispatch_offers
  for each row execute function private.on_offer_push();

-- Trip cancelled by someone other than the driver.
create function private.on_trip_cancel_driver_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_lang text;
  v_text jsonb;
begin
  if new.status = old.status or new.status not in ('cancelled_by_passenger', 'cancelled_by_admin', 'failed') then
    return new;
  end if;
  select u.user_id, u.lang into v_user, v_lang from private.driver_user(new.driver_id) u;
  v_text := private.driver_push_text('trip_cancelled', v_lang);
  perform private.enqueue_user_push(v_user, 'driver.trip', v_text ->> 'title', v_text ->> 'body', '/trip/' || new.id,
    jsonb_build_object('type', 'trip.cancelled', 'trip_id', new.id), 'trip:' || new.id || ':' || new.status || ':driver');
  return new;
end $$;

create trigger trg_trips_driver_cancel_push after update of status on public.trips
  for each row execute function private.on_trip_cancel_driver_push();

-- ---------------------------------------------------------------------------
-- 2. Availability and application status changes
-- ---------------------------------------------------------------------------
create function private.on_driver_status_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lang text;
  v_text jsonb;
  v_kind text;
begin
  if new.availability = old.availability and new.onboarding_status = old.onboarding_status then
    return new;
  end if;
  perform private.broadcast('driver:' || new.id, 'availability_changed',
    jsonb_build_object('availability', new.availability, 'onboarding_status', new.onboarding_status));

  select p.preferred_language::text into v_lang from public.profiles p where p.id = new.user_id;

  -- Taken offline by anyone but the driver (stale location sweep, ops, suspension, account deletion).
  if new.availability = 'offline' and old.availability <> 'offline' and auth.uid() is distinct from new.user_id
     and new.onboarding_status = old.onboarding_status then
    v_text := private.driver_push_text('forced_offline', v_lang);
    perform private.enqueue_user_push(new.user_id, 'driver.account', v_text ->> 'title', v_text ->> 'body', '/home',
      jsonb_build_object('type', 'forced_offline'), 'offline:' || new.id || ':' || extract(epoch from now())::bigint);
  end if;

  if new.onboarding_status <> old.onboarding_status and new.onboarding_status in ('approved', 'rejected', 'suspended') then
    v_kind := new.onboarding_status::text;
    v_text := private.driver_push_text(v_kind, v_lang);
    perform private.enqueue_user_push(new.user_id, 'driver.account', v_text ->> 'title', v_text ->> 'body',
      case v_kind when 'approved' then '/home' when 'rejected' then '/onboarding' else '/support' end,
      jsonb_build_object('type', 'account.' || v_kind), 'application:' || new.id || ':' || v_kind || ':' || extract(epoch from now())::bigint);
  end if;
  return new;
end $$;

create trigger trg_driver_profiles_status_change after update of availability, onboarding_status on public.driver_profiles
  for each row execute function private.on_driver_status_change();

-- ---------------------------------------------------------------------------
-- 3. Client config: timings the driver app needs
-- ---------------------------------------------------------------------------
create or replace function api.client_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  return jsonb_build_object(
    'flags', (select coalesce(jsonb_object_agg(key, private.flag_enabled(key, null, null, auth.uid())), '{}') from public.feature_flags),
    'settings', jsonb_build_object(
      'cancellation_free_window_s', private.setting('cancellation.free_window_s'),
      'quote_ttl_s', private.setting('quote.ttl_s'),
      'payment_methods', private.setting('payments.enabled_methods'),
      'rating_window_days', private.setting('ratings.window_days'),
      'offer_timeout_s', private.setting('dispatch.offer_timeout_s'),
      'no_show_wait_min', private.setting('cancellation.no_show_wait_min')));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Driver trip history
-- ---------------------------------------------------------------------------
create function api.driver_trips(p_limit integer default 30, p_cursor text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_role('driver');
  if p_cursor is not null then
    begin
      v_ts := split_part(p_cursor, '|', 1)::timestamptz;
      v_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"cursor","message":"Invalid cursor."}]}');
    end;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'status', x.status, 'accepted_at', x.accepted_at, 'completed_at', x.completed_at, 'cancelled_at', x.cancelled_at,
      'final_fare', x.final_fare, 'estimated_fare', x.estimated_fare, 'currency', 'BDT', 'payment_method', x.payment_method,
      'pickup_label', x.pickup_label, 'destination_label', x.destination_label, 'net_earning', x.net_earning,
      -- page_rows builds the next cursor from created_at|id.
      'created_at', x.accepted_at) order by x.accepted_at desc, x.id desc), '[]') into v_rows
  from (
    select t.id, t.status, t.accepted_at, t.completed_at, t.cancelled_at, t.final_fare, r.estimated_fare, t.payment_method,
           r.pickup_label, r.destination_label, e.net_earning
    from public.trips t
    join public.ride_requests r on r.id = t.request_id
    left join public.driver_earnings e on e.trip_id = t.id
    where t.driver_id = private.my_driver_id()
      and t.status in ('completed', 'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed')
      and (v_ts is null or (t.accepted_at, t.id) < (v_ts, v_id))
    order by t.accepted_at desc, t.id desc
    limit v_limit + 1
  ) x;
  return private.page_rows(v_rows, v_limit);
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function api.driver_trips(integer, text) from public, anon;
grant execute on function api.driver_trips(integer, text) to authenticated;
revoke execute on function
  private.driver_push_text(text, text, text, text), private.driver_user(uuid), private.on_offer_push(),
  private.on_trip_cancel_driver_push(), private.on_driver_status_change()
from public, anon, authenticated;
