
create table public.client_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_type text,
  source_id uuid,
  title text not null,
  note text,
  owner_user_id uuid not null references auth.users(id),
  due_at timestamptz not null,
  status text not null default 'open',
  resolution_note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  constraint client_follow_ups_source_pair_check check ((source_type is null) = (source_id is null)),
  constraint client_follow_ups_source_type_check check (source_type is null or source_type in ('contact','site','request','job','project')),
  constraint client_follow_ups_title_check check (char_length(btrim(title)) between 1 and 160),
  constraint client_follow_ups_note_check check (note is null or char_length(note) <= 2000),
  constraint client_follow_ups_resolution_note_check check (resolution_note is null or char_length(resolution_note) <= 2000),
  constraint client_follow_ups_status_check check (status in ('open','completed','cancelled')),
  constraint client_follow_ups_terminal_fields_check check (
    (status = 'open' and completed_by is null and completed_at is null and cancelled_by is null and cancelled_at is null)
    or (status = 'completed' and completed_by is not null and completed_at is not null and cancelled_by is null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_by is not null and cancelled_at is not null and completed_by is null and completed_at is null)
  )
);

create table public.client_follow_up_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  follow_up_id uuid not null references public.client_follow_ups(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint client_follow_up_events_type_check check (event_type in ('created','updated','reassigned','completed','cancelled','reopened')),
  constraint client_follow_up_events_payload_check check (octet_length(event_payload::text) <= 16384)
);

create table public.client_communication_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  preferred_contact_id uuid references public.client_contacts(id) on delete set null,
  preferred_channel text,
  do_not_contact_instruction text,
  contact_time_note text,
  language_note text,
  accessibility_note text,
  source_note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint client_communication_settings_client_key unique (organization_id, client_id),
  constraint client_communication_settings_channel_check check (preferred_channel is null or preferred_channel in ('phone','email','sms','letter','in_person')),
  constraint client_communication_settings_dnc_check check (do_not_contact_instruction is null or char_length(do_not_contact_instruction) <= 2000),
  constraint client_communication_settings_contact_time_check check (contact_time_note is null or char_length(contact_time_note) <= 1000),
  constraint client_communication_settings_language_check check (language_note is null or char_length(language_note) <= 200),
  constraint client_communication_settings_accessibility_check check (accessibility_note is null or char_length(accessibility_note) <= 1000),
  constraint client_communication_settings_source_note_check check (source_note is null or char_length(source_note) <= 1000)
);

create table public.client_communication_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.client_contacts(id) on delete cascade,
  channel text not null,
  purpose text not null,
  state text not null,
  source_note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint client_communication_preferences_scope_key unique nulls not distinct (organization_id, client_id, contact_id, channel, purpose),
  constraint client_communication_preferences_channel_check check (channel in ('phone','email','sms','letter','in_person')),
  constraint client_communication_preferences_purpose_check check (purpose in ('appointment_service','marketing','commercial_required')),
  constraint client_communication_preferences_state_check check (state in ('allowed','disallowed','unknown')),
  constraint client_communication_preferences_source_note_check check (source_note is null or char_length(source_note) <= 1000)
);

create table public.client_communication_preference_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  preference_id uuid references public.client_communication_preferences(id) on delete set null,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint client_communication_preference_events_type_check check (event_type in ('settings_created','settings_updated','preference_created','preference_updated','preference_cleared','exception_acknowledged')),
  constraint client_communication_preference_events_payload_check check (octet_length(event_payload::text) <= 16384)
);

create or replace function app_private.assert_p1_10_manager(p_organization_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_user_id and m.role in ('admin','buero')
  ) then raise exception 'P1-10 actor is not an active manager in the organization'; end if;
end;
$$;
revoke all on function app_private.assert_p1_10_manager(uuid,uuid) from public, anon, authenticated;
grant execute on function app_private.assert_p1_10_manager(uuid,uuid) to service_role;

create or replace function app_private.validate_client_follow_up_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.clients c where c.id=new.client_id and c.organization_id=new.organization_id)
    then raise exception 'follow-up customer organization mismatch'; end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id=new.organization_id and m.user_id=new.owner_user_id and m.role in ('admin','buero')
  ) then raise exception 'follow-up owner must be an active admin or buero member'; end if;
  if new.source_type = 'contact' and not exists (
    select 1 from public.client_contacts x where x.id=new.source_id and x.organization_id=new.organization_id and x.client_id=new.client_id
  ) then raise exception 'follow-up contact source mismatch';
  elsif new.source_type = 'site' and not exists (
    select 1 from public.client_sites x where x.id=new.source_id and x.organization_id=new.organization_id and x.client_id=new.client_id
  ) then raise exception 'follow-up site source mismatch';
  elsif new.source_type = 'request' and not exists (
    select 1 from public.client_requests x where x.id=new.source_id and x.organization_id=new.organization_id and x.client_id=new.client_id
  ) then raise exception 'follow-up request source mismatch';
  elsif new.source_type = 'job' and not exists (
    select 1 from public.jobs x where x.id=new.source_id and x.organization_id=new.organization_id and x.client_id=new.client_id
  ) then raise exception 'follow-up job source mismatch';
  elsif new.source_type = 'project' and not exists (
    select 1 from public.projects x where x.id=new.source_id and x.organization_id=new.organization_id and x.client_id=new.client_id
  ) then raise exception 'follow-up project source mismatch';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger validate_client_follow_up_org before insert or update on public.client_follow_ups
for each row execute function app_private.validate_client_follow_up_org();

create or replace function app_private.validate_client_follow_up_event_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.client_follow_ups f
    where f.id=new.follow_up_id and f.organization_id=new.organization_id and f.client_id=new.client_id
  ) then raise exception 'follow-up event organization or customer mismatch'; end if;
  return new;
end;
$$;
create trigger validate_client_follow_up_event_org before insert or update on public.client_follow_up_events
for each row execute function app_private.validate_client_follow_up_event_org();

create or replace function app_private.validate_client_communication_settings_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.clients c where c.id=new.client_id and c.organization_id=new.organization_id)
    then raise exception 'communication settings customer organization mismatch'; end if;
  if new.preferred_contact_id is not null and not exists (
    select 1 from public.client_contacts c
    where c.id=new.preferred_contact_id and c.client_id=new.client_id and c.organization_id=new.organization_id
  ) then raise exception 'preferred contact organization or customer mismatch'; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger validate_client_communication_settings_org before insert or update on public.client_communication_settings
for each row execute function app_private.validate_client_communication_settings_org();

create or replace function app_private.validate_client_communication_preference_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.clients c where c.id=new.client_id and c.organization_id=new.organization_id)
    then raise exception 'communication preference customer organization mismatch'; end if;
  if new.contact_id is not null and not exists (
    select 1 from public.client_contacts c
    where c.id=new.contact_id and c.client_id=new.client_id and c.organization_id=new.organization_id
  ) then raise exception 'communication preference contact mismatch'; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger validate_client_communication_preference_org before insert or update on public.client_communication_preferences
for each row execute function app_private.validate_client_communication_preference_org();

create or replace function app_private.validate_client_communication_event_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.clients c where c.id=new.client_id and c.organization_id=new.organization_id)
    then raise exception 'communication event customer organization mismatch'; end if;
  if new.preference_id is not null and not exists (
    select 1 from public.client_communication_preferences p
    where p.id=new.preference_id and p.client_id=new.client_id and p.organization_id=new.organization_id
  ) then raise exception 'communication event preference mismatch'; end if;
  return new;
end;
$$;
create trigger validate_client_communication_event_org before insert or update on public.client_communication_preference_events
for each row execute function app_private.validate_client_communication_event_org();

create or replace function public.create_client_follow_up(
  p_organization_id uuid,p_client_id uuid,p_title text,p_note text,p_owner_user_id uuid,p_due_at timestamptz,
  p_source_type text,p_source_id uuid,p_actor_id uuid
) returns public.client_follow_ups language plpgsql security invoker set search_path=public as $$
declare v_follow_up public.client_follow_ups;
begin
  perform app_private.assert_p1_10_manager(p_organization_id,p_actor_id);
  insert into public.client_follow_ups (
    organization_id,client_id,source_type,source_id,title,note,owner_user_id,due_at,created_by,updated_by
  ) values (
    p_organization_id,p_client_id,p_source_type,p_source_id,btrim(p_title),nullif(btrim(coalesce(p_note,'')),''),
    p_owner_user_id,p_due_at,p_actor_id,p_actor_id
  ) returning * into v_follow_up;
  insert into public.client_follow_up_events (organization_id,client_id,follow_up_id,event_type,event_payload,actor_id)
  values (p_organization_id,p_client_id,v_follow_up.id,'created',
    jsonb_build_object('ownerUserId',p_owner_user_id,'dueAt',p_due_at,'sourceType',p_source_type,'sourceId',p_source_id),p_actor_id);
  return v_follow_up;
end;
$$;

create or replace function public.update_client_follow_up(
  p_follow_up_id uuid,p_organization_id uuid,p_title text,p_note text,p_owner_user_id uuid,p_due_at timestamptz,
  p_source_type text,p_source_id uuid,p_actor_id uuid,p_reason text default null
) returns public.client_follow_ups language plpgsql security invoker set search_path=public as $$
declare v_before public.client_follow_ups; v_after public.client_follow_ups; v_event_type text;
begin
  perform app_private.assert_p1_10_manager(p_organization_id,p_actor_id);
  select * into v_before from public.client_follow_ups
  where id=p_follow_up_id and organization_id=p_organization_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if v_before.status <> 'open' then raise exception 'only open follow-ups can be edited'; end if;
  update public.client_follow_ups set title=btrim(p_title),note=nullif(btrim(coalesce(p_note,'')),''),
    owner_user_id=p_owner_user_id,due_at=p_due_at,source_type=p_source_type,source_id=p_source_id,updated_by=p_actor_id
  where id=p_follow_up_id returning * into v_after;
  v_event_type := case when v_before.owner_user_id is distinct from v_after.owner_user_id then 'reassigned' else 'updated' end;
  insert into public.client_follow_up_events (organization_id,client_id,follow_up_id,event_type,event_payload,actor_id)
  values (p_organization_id,v_after.client_id,v_after.id,v_event_type,
    jsonb_build_object(
      'before',jsonb_build_object('title',v_before.title,'ownerUserId',v_before.owner_user_id,'dueAt',v_before.due_at,'sourceType',v_before.source_type,'sourceId',v_before.source_id),
      'after',jsonb_build_object('title',v_after.title,'ownerUserId',v_after.owner_user_id,'dueAt',v_after.due_at,'sourceType',v_after.source_type,'sourceId',v_after.source_id),
      'reason',nullif(btrim(coalesce(p_reason,'')),'')
    ),p_actor_id);
  return v_after;
end;
$$;

create or replace function public.transition_client_follow_up(
  p_follow_up_id uuid,p_organization_id uuid,p_target_status text,p_resolution_note text,p_actor_id uuid,p_reason text default null
) returns public.client_follow_ups language plpgsql security invoker set search_path=public as $$
declare v_before public.client_follow_ups; v_after public.client_follow_ups; v_event_type text;
begin
  perform app_private.assert_p1_10_manager(p_organization_id,p_actor_id);
  select * into v_before from public.client_follow_ups
  where id=p_follow_up_id and organization_id=p_organization_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if p_target_status in ('completed','cancelled') and v_before.status <> 'open'
    then raise exception 'only open follow-ups can be completed or cancelled'; end if;
  if p_target_status='open' and v_before.status not in ('completed','cancelled')
    then raise exception 'only terminal follow-ups can be reopened'; end if;
  if p_target_status='open' and char_length(btrim(coalesce(p_reason,'')))=0
    then raise exception 'reopening requires a reason'; end if;
  if p_target_status not in ('open','completed','cancelled') then raise exception 'invalid follow-up target status'; end if;
  update public.client_follow_ups set
    status=p_target_status,
    resolution_note=case when p_target_status='open' then null else nullif(btrim(coalesce(p_resolution_note,'')),'') end,
    completed_by=case when p_target_status='completed' then p_actor_id else null end,
    completed_at=case when p_target_status='completed' then now() else null end,
    cancelled_by=case when p_target_status='cancelled' then p_actor_id else null end,
    cancelled_at=case when p_target_status='cancelled' then now() else null end,
    updated_by=p_actor_id
  where id=p_follow_up_id returning * into v_after;
  v_event_type := case p_target_status when 'completed' then 'completed' when 'cancelled' then 'cancelled' else 'reopened' end;
  insert into public.client_follow_up_events (organization_id,client_id,follow_up_id,event_type,event_payload,actor_id)
  values (p_organization_id,v_after.client_id,v_after.id,v_event_type,
    jsonb_build_object('previousStatus',v_before.status,'status',v_after.status,'resolutionNote',v_after.resolution_note,'reason',nullif(btrim(coalesce(p_reason,'')),'')),p_actor_id);
  return v_after;
end;
$$;

create or replace function public.save_client_communication_settings(
  p_organization_id uuid,p_client_id uuid,p_preferred_contact_id uuid,p_preferred_channel text,
  p_do_not_contact_instruction text,p_contact_time_note text,p_language_note text,p_accessibility_note text,
  p_source_note text,p_actor_id uuid
) returns public.client_communication_settings language plpgsql security invoker set search_path=public as $$
declare v_before public.client_communication_settings; v_after public.client_communication_settings; v_exists boolean:=false;
begin
  perform app_private.assert_p1_10_manager(p_organization_id,p_actor_id);
  select * into v_before from public.client_communication_settings
  where organization_id=p_organization_id and client_id=p_client_id for update;
  v_exists:=found;
  if v_exists then
    update public.client_communication_settings set preferred_contact_id=p_preferred_contact_id,preferred_channel=p_preferred_channel,
      do_not_contact_instruction=nullif(btrim(coalesce(p_do_not_contact_instruction,'')),''),
      contact_time_note=nullif(btrim(coalesce(p_contact_time_note,'')),''),
      language_note=nullif(btrim(coalesce(p_language_note,'')),''),
      accessibility_note=nullif(btrim(coalesce(p_accessibility_note,'')),''),
      source_note=nullif(btrim(coalesce(p_source_note,'')),''),
      updated_by=p_actor_id
    where id=v_before.id returning * into v_after;
  else
    insert into public.client_communication_settings (
      organization_id,client_id,preferred_contact_id,preferred_channel,do_not_contact_instruction,contact_time_note,
      language_note,accessibility_note,source_note,created_by,updated_by
    ) values (
      p_organization_id,p_client_id,p_preferred_contact_id,p_preferred_channel,
      nullif(btrim(coalesce(p_do_not_contact_instruction,'')),''),
      nullif(btrim(coalesce(p_contact_time_note,'')),''),
      nullif(btrim(coalesce(p_language_note,'')),''),
      nullif(btrim(coalesce(p_accessibility_note,'')),''),
      nullif(btrim(coalesce(p_source_note,'')),''),
      p_actor_id,p_actor_id
    ) returning * into v_after;
  end if;
  insert into public.client_communication_preference_events (organization_id,client_id,event_type,event_payload,actor_id)
  values (p_organization_id,p_client_id,case when v_exists then 'settings_updated' else 'settings_created' end,
    jsonb_build_object('before',case when v_exists then to_jsonb(v_before)-array['organization_id','client_id'] else null end,
      'after',to_jsonb(v_after)-array['organization_id','client_id']),p_actor_id);
  return v_after;
end;
$$;

create or replace function public.set_client_communication_preference(
  p_organization_id uuid,p_client_id uuid,p_contact_id uuid,p_channel text,p_purpose text,p_state text,
  p_source_note text,p_actor_id uuid
) returns public.client_communication_preferences language plpgsql security invoker set search_path=public as $$
declare v_before public.client_communication_preferences; v_after public.client_communication_preferences; v_exists boolean:=false;
begin
  perform app_private.assert_p1_10_manager(p_organization_id,p_actor_id);
  select * into v_before from public.client_communication_preferences
  where organization_id=p_organization_id and client_id=p_client_id and contact_id is not distinct from p_contact_id
    and channel=p_channel and purpose=p_purpose for update;
  v_exists:=found;
  if v_exists then
    update public.client_communication_preferences set state=p_state,
      source_note=nullif(btrim(coalesce(p_source_note,'')),''),updated_by=p_actor_id
    where id=v_before.id returning * into v_after;
  else
    insert into public.client_communication_preferences (
      organization_id,client_id,contact_id,channel,purpose,state,source_note,created_by,updated_by
    ) values (
      p_organization_id,p_client_id,p_contact_id,p_channel,p_purpose,p_state,
      nullif(btrim(coalesce(p_source_note,'')),''),p_actor_id,p_actor_id
    ) returning * into v_after;
  end if;
  insert into public.client_communication_preference_events (organization_id,client_id,preference_id,event_type,event_payload,actor_id)
  values (p_organization_id,p_client_id,v_after.id,
    case when v_exists and p_state='unknown' then 'preference_cleared' when v_exists then 'preference_updated' else 'preference_created' end,
    jsonb_build_object('contactId',p_contact_id,'channel',p_channel,'purpose',p_purpose,
      'beforeState',case when v_exists then v_before.state else null end,'state',v_after.state,'sourceNote',v_after.source_note),p_actor_id);
  return v_after;
end;
$$;

create or replace function public.record_client_communication_exception(
  p_organization_id uuid,p_client_id uuid,p_contact_id uuid,p_channel text,p_purpose text,
  p_warnings jsonb,p_reason text,p_actor_id uuid
) returns uuid language plpgsql security invoker set search_path=public as $$
declare v_event_id uuid;
begin
  perform app_private.assert_p1_10_manager(p_organization_id,p_actor_id);
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 1000
    then raise exception 'communication exception reason is required and limited to 1000 characters'; end if;
  if p_channel not in ('phone','email','sms','letter','in_person') then raise exception 'invalid channel'; end if;
  if p_purpose not in ('appointment_service','marketing','commercial_required') then raise exception 'invalid purpose'; end if;
  if not exists (select 1 from public.clients where id=p_client_id and organization_id=p_organization_id)
    then raise exception 'communication exception customer mismatch'; end if;
  if p_contact_id is not null and not exists (
    select 1 from public.client_contacts where id=p_contact_id and client_id=p_client_id and organization_id=p_organization_id
  ) then raise exception 'communication exception contact mismatch'; end if;
  insert into public.client_communication_preference_events (organization_id,client_id,event_type,event_payload,actor_id)
  values (p_organization_id,p_client_id,'exception_acknowledged',
    jsonb_build_object('contactId',p_contact_id,'channel',p_channel,'purpose',p_purpose,
      'warnings',coalesce(p_warnings,'[]'::jsonb),'reason',btrim(p_reason),'outcome','contact_app_opened_not_delivered'),p_actor_id)
  returning id into v_event_id;
  return v_event_id;
end;
$$;

revoke all on function public.create_client_follow_up(uuid,uuid,text,text,uuid,timestamptz,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.update_client_follow_up(uuid,uuid,text,text,uuid,timestamptz,text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.transition_client_follow_up(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.save_client_communication_settings(uuid,uuid,uuid,text,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.set_client_communication_preference(uuid,uuid,uuid,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.record_client_communication_exception(uuid,uuid,uuid,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.create_client_follow_up(uuid,uuid,text,text,uuid,timestamptz,text,uuid,uuid) to service_role;
grant execute on function public.update_client_follow_up(uuid,uuid,text,text,uuid,timestamptz,text,uuid,uuid,text) to service_role;
grant execute on function public.transition_client_follow_up(uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.save_client_communication_settings(uuid,uuid,uuid,text,text,text,text,text,text,uuid) to service_role;
grant execute on function public.set_client_communication_preference(uuid,uuid,uuid,text,text,text,text,uuid) to service_role;
grant execute on function public.record_client_communication_exception(uuid,uuid,uuid,text,text,jsonb,text,uuid) to service_role;

alter table public.client_follow_ups enable row level security;
alter table public.client_follow_up_events enable row level security;
alter table public.client_communication_settings enable row level security;
alter table public.client_communication_preferences enable row level security;
alter table public.client_communication_preference_events enable row level security;
create policy "Managers can view client follow-ups" on public.client_follow_ups for select to authenticated
using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy "Managers can view client follow-up events" on public.client_follow_up_events for select to authenticated
using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy "Managers can view client communication settings" on public.client_communication_settings for select to authenticated
using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy "Managers can view client communication preferences" on public.client_communication_preferences for select to authenticated
using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy "Managers can view client communication preference events" on public.client_communication_preference_events for select to authenticated
using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

grant select on public.client_follow_ups,public.client_follow_up_events,public.client_communication_settings,
  public.client_communication_preferences,public.client_communication_preference_events to authenticated;
grant all on public.client_follow_ups,public.client_follow_up_events,public.client_communication_settings,
  public.client_communication_preferences,public.client_communication_preference_events to service_role;

drop policy "Users can view clients in their orgs" on public.clients;
drop policy "Users can view client contacts in their orgs" on public.client_contacts;
drop policy "Users can view client sites in their orgs" on public.client_sites;
create policy "Managers can view clients in their orgs" on public.clients for select to authenticated
using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy "Managers can view client contacts in their orgs" on public.client_contacts for select to authenticated
using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy "Managers can view client sites in their orgs" on public.client_sites for select to authenticated
using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

create index client_follow_ups_client_status_due_idx on public.client_follow_ups (organization_id,client_id,status,due_at,id);
create index client_follow_ups_owner_open_due_idx on public.client_follow_ups (organization_id,owner_user_id,due_at,id) where status='open';
create index client_follow_up_events_client_created_idx on public.client_follow_up_events (organization_id,client_id,created_at desc,id desc);
create index client_communication_preferences_client_updated_idx on public.client_communication_preferences (organization_id,client_id,updated_at desc,id desc);
create index client_communication_preference_events_client_created_idx on public.client_communication_preference_events (organization_id,client_id,created_at desc,id desc);
create index client_contacts_timeline_idx on public.client_contacts (organization_id,client_id,created_at desc,id desc);
create index client_sites_timeline_idx on public.client_sites (organization_id,client_id,created_at desc,id desc);
create index client_requests_timeline_idx on public.client_requests (organization_id,client_id,received_at desc,id desc) where client_id is not null;
create index jobs_client_timeline_idx on public.jobs (organization_id,client_id,created_at desc,id desc) where client_id is not null;
create index projects_client_timeline_idx on public.projects (organization_id,client_id,created_at desc,id desc) where client_id is not null;
create index document_links_client_timeline_idx on public.document_links (organization_id,client_id,created_at desc,id desc) where client_id is not null;

alter table public.client_follow_ups replica identity full;
alter table public.client_communication_settings replica identity full;
alter table public.client_communication_preferences replica identity full;
alter publication supabase_realtime add table public.client_follow_ups;
alter publication supabase_realtime add table public.client_communication_settings;
alter publication supabase_realtime add table public.client_communication_preferences;
