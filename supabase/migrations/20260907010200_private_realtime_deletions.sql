-- Raw Postgres DELETE delivery bypasses RLS. Replace it with INSERT-only,
-- tenant-authorized invalidations; application and publication roll out together.
alter publication supabase_realtime set (publish = 'insert, update');

create table public.realtime_deletions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
create index realtime_deletions_expiry_idx on public.realtime_deletions(created_at);
create index realtime_deletions_organization_idx on public.realtime_deletions(organization_id);
create unique index realtime_deletions_replident_idx on public.realtime_deletions(id, organization_id);
alter table public.realtime_deletions replica identity using index realtime_deletions_replident_idx;
alter table public.realtime_deletions enable row level security;
revoke all on public.realtime_deletions from public, anon, authenticated;
grant select on public.realtime_deletions to authenticated;
grant all on public.realtime_deletions to service_role;
create policy realtime_deletions_current_members on public.realtime_deletions
  for select to authenticated using (
    organization_id in (select app_private.get_user_org_ids((select auth.uid())))
    and created_at > now() - interval '1 hour'
  );

create function app_private.emit_realtime_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous_row jsonb := to_jsonb(old);
  target_organization uuid;
  target_row uuid;
begin
  if tg_op <> 'DELETE' or tg_table_schema <> 'public' then
    raise exception 'realtime_deletion_invalid_trigger';
  end if;
  if tg_table_name = 'profiles' then
    -- A direct profile deletion may precede the membership cascade. Membership
    -- deletion also emits this invalidation when the cascade runs first.
    for target_organization in
      select organization_id from public.organization_members where user_id = old.id
    loop
      if not coalesce(target_organization::text = any(string_to_array(
        current_setting('app.deleting_organization_ids', true), ',')), false)
        and exists (select 1 from public.organizations where id = target_organization)
      then
        insert into public.realtime_deletions(organization_id,table_name,row_id)
          values(target_organization,'profiles',old.id);
      end if;
    end loop;
    return old;
  end if;

  target_organization := (previous_row->>'organization_id')::uuid;
  target_row := coalesce((previous_row->>'id')::uuid, target_organization);
  if target_organization is null or target_row is null then
    raise exception 'realtime_deletion_missing_identity';
  end if;
  if coalesce(target_organization::text = any(string_to_array(
    current_setting('app.deleting_organization_ids', true), ',')), false)
    or not exists (select 1 from public.organizations where id = target_organization)
  then return old; end if;

  insert into public.realtime_deletions(organization_id,table_name,row_id)
    values(target_organization,tg_table_name,target_row);
  if tg_table_name = 'organization_members' then
    insert into public.realtime_deletions(organization_id,table_name,row_id)
      values(target_organization,'profiles',(previous_row->>'user_id')::uuid);
  end if;
  return old;
end;
$$;
revoke all on function app_private.emit_realtime_deletion() from public, anon, authenticated;
grant execute on function app_private.emit_realtime_deletion() to postgres, service_role;

-- Attach to the existing publication inventory. A future added table must add
-- this trigger in its own migration; realtime:check rejects missing coverage.
do $$
declare published record;
begin
  for published in select schemaname,tablename from pg_publication_tables
    where pubname='supabase_realtime'
  loop
    if published.schemaname <> 'public' then raise exception 'unexpected_realtime_schema'; end if;
    execute format('create trigger emit_realtime_deletion after delete on %I.%I for each row execute function app_private.emit_realtime_deletion()',
      published.schemaname,published.tablename);
  end loop;
end;
$$;
alter publication supabase_realtime add table public.realtime_deletions;

-- Ephemeral invalidations are not an audit ledger. Reconnects refetch the
-- current authorized state instead of replaying these rows. Physical cleanup
-- is bounded per run; RLS expires read visibility independently of job delays.
create function app_private.prune_realtime_deletions()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.realtime_deletions where id in (
    select id from public.realtime_deletions
    where created_at <= clock_timestamp() - interval '1 hour'
    order by created_at limit 10000 for update skip locked
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function app_private.prune_realtime_deletions() from public, anon, authenticated;
grant execute on function app_private.prune_realtime_deletions() to postgres, service_role;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('werkflow-realtime-deletions-cleanup','*/5 * * * *',
  'select app_private.prune_realtime_deletions()');
