begin;
select plan(3);

select is((select count(*)::int from pg_inherits i join pg_class c on c.oid = i.inhrelid
           where i.inhparent = 'public.trip_location_points'::regclass and not (c.relrowsecurity and c.relforcerowsecurity)),
          0, 'every trip_location_points partition has forced RLS');

select is((select count(*)::int from pg_inherits i join pg_class c on c.oid = i.inhrelid
           where i.inhparent = 'public.trip_location_points'::regclass
             and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))),
          0, 'no partition is directly readable by anon or authenticated');

select private.ensure_trip_point_partitions(8);
select is((select count(*)::int from pg_inherits i join pg_class c on c.oid = i.inhrelid
           where i.inhparent = 'public.trip_location_points'::regclass and not (c.relrowsecurity and c.relforcerowsecurity)),
          0, 'partitions created later are locked down too');

select * from finish();
rollback;
