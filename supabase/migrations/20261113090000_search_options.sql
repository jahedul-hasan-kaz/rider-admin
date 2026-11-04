-- Server-side autocomplete for pickers whose options come from the database (zones, vehicle types, people, admins).
-- Returns at most p_limit matches ({value, label, hint}); each kind checks the same permission as the page it serves.

create function api.search_options(p_kind text, p_query text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := '%' || replace(replace(btrim(coalesce(p_query, '')), '%', ''), '_', '') || '%';
  n integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if not private.is_admin() then
    perform private.raise_error('FORBIDDEN');
  end if;
  case p_kind
    when 'zones' then
      return (select coalesce(jsonb_agg(jsonb_build_object('value', z.id, 'label', z.name, 'hint', case when not z.active then 'inactive' end) order by z.name), '[]')
              from (select * from public.service_zones where name ilike q or code ilike q order by active desc, name limit n) z);
    when 'categories' then
      return (select coalesce(jsonb_agg(jsonb_build_object('value', c.id, 'label', c.name, 'hint', case when not c.active then 'inactive' end) order by c.sort_order, c.name), '[]')
              from (select * from public.vehicle_categories where name ilike q or code ilike q order by sort_order, name limit n) c);
    when 'passengers' then
      perform private.require_permission('passengers.view');
      return (select coalesce(jsonb_agg(jsonb_build_object('value', p.id, 'label', p.full_name, 'hint', private.mask_phone(p.phone)) order by p.full_name), '[]')
              from (select * from public.profiles where role = 'passenger' and status = 'active' and deleted_at is null
                      and (full_name ilike q or email::text ilike q or phone like q) order by full_name limit n) p);
    when 'drivers' then
      perform private.require_permission('drivers.view');
      return (select coalesce(jsonb_agg(jsonb_build_object('value', x.id, 'label', x.full_name,
                'hint', concat_ws(' · ', x.availability::text, (select v.registration_number from public.vehicles v where v.id = x.current_vehicle_id)),
                'category_id', (select v.category_id from public.vehicles v where v.id = x.current_vehicle_id)) order by x.full_name), '[]')
              from (select d.id, d.availability, d.current_vehicle_id, p.full_name from public.driver_profiles d join public.profiles p on p.id = d.user_id
                    where p.deleted_at is null and (p.full_name ilike q or p.email::text ilike q or p.phone like q) order by p.full_name limit n) x);
    when 'admins' then
      if not (private.has_permission('admins.view') or private.has_permission('support.assign')) then
        perform private.raise_error('FORBIDDEN');
      end if;
      return (select coalesce(jsonb_agg(jsonb_build_object('value', p.id, 'label', p.full_name, 'hint', p.email) order by p.full_name), '[]')
              from (select * from public.profiles where role = 'admin' and status = 'active' and deleted_at is null
                      and (full_name ilike q or email::text ilike q) order by full_name limit n) p);
    else
      perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"kind","message":"Unknown list."}]}');
  end case;
  return '[]'::jsonb; -- not reached
end $$;

revoke execute on function api.search_options(text, text, integer) from public, anon;
grant execute on function api.search_options(text, text, integer) to authenticated;
