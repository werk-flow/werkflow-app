-- Local, rollback-only security proof. Live receiver assertions belong to the
-- provider canary; a catalog assertion alone cannot prove transport isolation.
begin;

do $$
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime'
    and pubinsert and pubupdate and not pubdelete and not pubtruncate) then
    raise exception 'raw_realtime_delete_or_truncate_enabled';
  end if;
  if exists (
    select 1 from pg_publication_tables p
    join pg_namespace n on n.nspname=p.schemaname
    join pg_class c on c.relnamespace=n.oid and c.relname=p.tablename
    where p.pubname='supabase_realtime' and p.tablename<>'realtime_deletions'
      and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid
        and t.tgname='emit_realtime_deletion' and t.tgenabled='O' and t.tgtype=9
        and t.tgfoid='app_private.emit_realtime_deletion()'::regprocedure)
  ) then raise exception 'published_table_missing_deletion_trigger'; end if;
  if not exists(select 1 from cron.job where jobname='werkflow-realtime-deletions-cleanup'
    and active and schedule='*/5 * * * *'
    and command='select app_private.prune_realtime_deletions()') then
    raise exception 'realtime_retention_schedule_missing';
  end if;
  if has_function_privilege('authenticated','app_private.prune_realtime_deletions()','execute')
    or has_function_privilege('anon','app_private.prune_realtime_deletions()','execute')
    or has_function_privilege('authenticated','app_private.emit_realtime_deletion()','execute')
    or has_function_privilege('anon','app_private.emit_realtime_deletion()','execute') then
    raise exception 'realtime_internal_function_exposed';
  end if;
end $$;

set local role anon;
do $$ begin
  begin
    perform 1 from public.realtime_deletions;
    raise exception 'anonymous_deletion_read_allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('57000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','realtime-admin@example.test','',now(),'{}','{"first_name":"Synthetic","last_name":"Admin"}',now(),now()),
('57000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','realtime-member@example.test','',now(),'{}','{"first_name":"Synthetic","last_name":"Member"}',now(),now()),
('57000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','realtime-outsider@example.test','',now(),'{}','{"first_name":"Synthetic","last_name":"Outsider"}',now(),now());
set local role service_role;
insert into public.organizations(id,name,admin_id,unique_code) values
('57000000-0000-0000-0000-000000000010','Realtime synthetic','57000000-0000-0000-0000-000000000001','RTSQLA'),
('57000000-0000-0000-0000-000000000011','Realtime outsider','57000000-0000-0000-0000-000000000003','RTSQLB');
insert into public.organization_members(organization_id,user_id,role) values
('57000000-0000-0000-0000-000000000010','57000000-0000-0000-0000-000000000002','employee');
insert into public.clients(id,organization_id,name) values
('57000000-0000-0000-0000-000000000020','57000000-0000-0000-0000-000000000010','Synthetic deleted client');
delete from public.clients where id='57000000-0000-0000-0000-000000000020';
insert into public.organization_settings(organization_id) values('57000000-0000-0000-0000-000000000010')
  on conflict(organization_id) do nothing;
delete from public.organization_settings where organization_id='57000000-0000-0000-0000-000000000010';

do $$ begin
  if not exists(select 1 from public.realtime_deletions where organization_id='57000000-0000-0000-0000-000000000010'
    and table_name='clients' and row_id='57000000-0000-0000-0000-000000000020') then raise exception 'client_delete_invalidation_missing'; end if;
  if not exists(select 1 from public.realtime_deletions where organization_id='57000000-0000-0000-0000-000000000010'
    and table_name='organization_settings' and row_id='57000000-0000-0000-0000-000000000010') then raise exception 'organization_pk_invalidation_missing'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"57000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
do $$ begin
  if not exists(select 1 from public.realtime_deletions where row_id='57000000-0000-0000-0000-000000000020') then raise exception 'current_member_cannot_read_deletion'; end if;
  begin
    insert into public.realtime_deletions(organization_id,table_name,row_id) values
      ('57000000-0000-0000-0000-000000000010','clients','57000000-0000-0000-0000-000000000020');
    raise exception 'client_forged_deletion';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.realtime_deletions where row_id='57000000-0000-0000-0000-000000000020';
    raise exception 'client_deleted_invalidation';
  exception when insufficient_privilege then null; end;
end $$;

set local role service_role;
delete from public.organization_members where organization_id='57000000-0000-0000-0000-000000000010'
  and user_id='57000000-0000-0000-0000-000000000002';
do $$ begin
  if not exists(select 1 from public.realtime_deletions where organization_id='57000000-0000-0000-0000-000000000010'
    and table_name='profiles' and row_id='57000000-0000-0000-0000-000000000002') then raise exception 'removed_member_profile_invalidation_missing'; end if;
end $$;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.realtime_deletions where organization_id='57000000-0000-0000-0000-000000000010') then raise exception 'revoked_member_reads_deletions'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"57000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.realtime_deletions where organization_id='57000000-0000-0000-0000-000000000010') then raise exception 'foreign_member_reads_deletions'; end if;
end $$;

set local role service_role;
insert into public.realtime_deletions(id,organization_id,table_name,row_id,created_at) values
('57000000-0000-0000-0000-000000000030','57000000-0000-0000-0000-000000000010','clients','57000000-0000-0000-0000-000000000020',now()-interval '2 hours');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"57000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.realtime_deletions where id='57000000-0000-0000-0000-000000000030') then raise exception 'expired_invalidation_visible'; end if;
end $$;
set local role service_role;
do $$ declare removed integer; begin
  removed := app_private.prune_realtime_deletions();
  if removed < 1 or removed > 10000 then raise exception 'invalid_retention_batch'; end if;
  if exists(select 1 from public.realtime_deletions where id='57000000-0000-0000-0000-000000000030') then raise exception 'expired_invalidation_not_pruned'; end if;
  if not exists(select 1 from public.realtime_deletions where table_name='clients' and row_id='57000000-0000-0000-0000-000000000020') then raise exception 'fresh_invalidation_pruned'; end if;
end $$;

reset role;
delete from public.organizations where id in ('57000000-0000-0000-0000-000000000010','57000000-0000-0000-0000-000000000011');
do $$ begin
  if exists(select 1 from public.realtime_deletions where organization_id in ('57000000-0000-0000-0000-000000000010','57000000-0000-0000-0000-000000000011')) then raise exception 'organization_cascade_retained_invalidations'; end if;
end $$;
rollback;
