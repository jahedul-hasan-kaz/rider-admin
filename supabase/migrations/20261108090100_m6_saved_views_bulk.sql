-- Saved views for the admin list pages and bulk ticket assignment (docs/spec/06 §4).

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id),
  page text not null check (page in ('trips', 'requests', 'payments', 'support', 'drivers', 'passengers', 'documents', 'vehicles', 'refunds', 'ratings', 'safety', 'audit')),
  name text not null check (length(btrim(name)) between 1 and 60),
  query text not null default '' check (length(query) <= 500 and query !~ '[<>"]'),
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index uq_saved_views_name on public.saved_views (owner_id, page, lower(name)) where deleted_at is null;
create index idx_saved_views_page on public.saved_views (page) where deleted_at is null;
alter table public.saved_views enable row level security;
alter table public.saved_views force row level security;
revoke all on public.saved_views from public, anon, authenticated;
create trigger trg_saved_views_no_delete before delete on public.saved_views
  for each row execute function private.forbid_delete();

-- A person's own views, plus views colleagues shared, for one page.
create function api.list_saved_views(p_page text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    perform private.raise_error('FORBIDDEN');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'query', v.query, 'is_shared', v.is_shared, 'mine', v.owner_id = auth.uid(),
      'owner_name', case when v.owner_id <> auth.uid() then (select full_name from public.profiles p where p.id = v.owner_id) end)
      order by (v.owner_id = auth.uid()) desc, lower(v.name)), '[]')
    from public.saved_views v where v.page = p_page and v.deleted_at is null and (v.owner_id = auth.uid() or v.is_shared));
end $$;

create function api.save_view(p_page text, p_name text, p_query text, p_shared boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_query text := ltrim(coalesce(p_query, ''), '?');
begin
  if not private.is_admin() then
    perform private.raise_error('FORBIDDEN');
  end if;
  if (select count(*) from public.saved_views where owner_id = auth.uid() and deleted_at is null) >= 50 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"name","message":"You can keep up to 50 saved views."}]}');
  end if;
  begin
    insert into public.saved_views (owner_id, page, name, query, is_shared) values (auth.uid(), p_page, btrim(p_name), v_query, coalesce(p_shared, false))
    returning id into v_id;
  exception
    when unique_violation then
      perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"name","message":"You already have a view with this name."}]}');
    when check_violation then
      perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"name","message":"Give the view a name of up to 60 characters."}]}');
  end;
  return jsonb_build_object('id', v_id);
end $$;

create function api.delete_view(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.saved_views set deleted_at = now() where id = p_id and owner_id = auth.uid() and deleted_at is null;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
end $$;

-- Assigns several tickets at once (safe and reversible: each is the same single assignment, audited one by one).
create function api.assign_tickets(p_ids uuid[], p_assignee uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  n integer := 0;
begin
  perform private.require_permission('support.assign');
  if p_ids is null or cardinality(p_ids) not between 1 and 100 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"ids","message":"Select between 1 and 100 tickets."}]}');
  end if;
  foreach v_id in array p_ids loop
    perform api.assign_ticket(v_id, p_assignee);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on all functions in schema api from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_permission(text), private.is_admin(), private.has_aal2(), private.current_app_role(),
  private.can_upload_driver_document(text), private.my_driver_id(), private.my_trip_ids(), private.can_receive_topic(text),
  private.can_upload_incident_evidence(text)
to authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'
           and p.proname not in ('claim_notifications', 'finish_notification', 'claim_storage_purges', 'finish_storage_purge') loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
