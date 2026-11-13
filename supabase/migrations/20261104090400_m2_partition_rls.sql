-- Partitions of trip_location_points do not inherit RLS or the parent's grants. Supabase's default
-- privileges let anon/authenticated read every new public table, so each partition was directly
-- readable over the REST API (GPS trails). Lock them down: RLS forced, no direct grants. All access
-- goes through the parent table or api.* functions (security definer).

create function private.lock_trip_point_partition(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  execute format('alter table public.%I enable row level security', p_name);
  execute format('alter table public.%I force row level security', p_name);
  execute format('revoke all on public.%I from public, anon, authenticated', p_name);
end $$;
revoke all on function private.lock_trip_point_partition(text) from public, anon, authenticated;

create or replace function private.ensure_trip_point_partitions(p_months_ahead integer default 3) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_end date;
  v_name text;
begin
  for i in 0 .. p_months_ahead loop
    v_end := (v_month + interval '1 month')::date;
    v_name := 'trip_location_points_' || to_char(v_month, 'YYYY_MM');
    if to_regclass('public.' || v_name) is null then
      execute format('create table public.%I partition of public.trip_location_points for values from (%L) to (%L)', v_name, v_month, v_end);
      perform private.lock_trip_point_partition(v_name);
    end if;
    v_month := v_end;
  end loop;
end $$;

-- The default partition (catch-all) and every partition that already exists.
do $$
declare r record;
begin
  for r in
    select c.relname from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.trip_location_points'::regclass
  loop
    perform private.lock_trip_point_partition(r.relname);
  end loop;
end $$;
