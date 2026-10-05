-- A correction is validated in TypeScript against an effective timeline. The
-- database rejects that result if any time fact changed before application.
create table public.time_timeline_revisions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0)
);
alter table public.time_timeline_revisions enable row level security;
revoke all on public.time_timeline_revisions from public, anon, authenticated, service_role;
grant select on public.time_timeline_revisions to service_role;
insert into public.time_timeline_revisions (organization_id) select id from public.organizations;

create function app_private.advance_time_timeline_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  for v_org in
    select distinct identifier from unnest(array[
      case when tg_op <> 'INSERT' then old.organization_id end,
      case when tg_op <> 'DELETE' then new.organization_id end
    ]) identifier where identifier is not null order by identifier
  loop
    -- Organization deletion owns its cascading cleanup.
    if exists (select 1 from public.organizations where id = v_org) then
      insert into public.time_timeline_revisions (organization_id, revision) values (v_org, 1)
      on conflict (organization_id) do update set revision = public.time_timeline_revisions.revision + 1;
    end if;
  end loop;
  perform set_config('app.time_correction_fence', '', true);
  return null;
end;
$$;
revoke all on function app_private.advance_time_timeline_revision() from public, anon, authenticated, service_role;

create trigger advance_time_entry_revision after insert or update or delete on public.time_entries
for each row execute function app_private.advance_time_timeline_revision();
create trigger advance_time_segment_revision after insert or update or delete on public.time_segments
for each row execute function app_private.advance_time_timeline_revision();

create function app_private.guard_time_correction_timeline_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_current bigint;
  v_expected bigint;
  v_fence text;
begin
  v_expected := (new.responsibility_snapshot ->> 'timelineRevision')::bigint;
  if v_expected is null then raise exception 'time_correction_timeline_changed'; end if;
  insert into public.time_timeline_revisions (organization_id) values (new.organization_id)
  on conflict (organization_id) do nothing;
  select revision into v_current from public.time_timeline_revisions
  where organization_id = new.organization_id for update;
  v_fence := new.organization_id::text || ':' || v_expected::text;
  -- One validated batch shares the locked revision. Raw/segment writes clear
  -- this marker, so intervening work in the same transaction cannot bypass it.
  if current_setting('app.time_correction_fence', true) is distinct from v_fence then
    if v_current <> v_expected then raise exception 'time_correction_timeline_changed'; end if;
    perform set_config('app.time_correction_fence', v_fence, true);
  end if;
  update public.time_timeline_revisions set revision = revision + 1
  where organization_id = new.organization_id;
  return new;
end;
$$;
revoke all on function app_private.guard_time_correction_timeline_revision() from public, anon, authenticated, service_role;
create trigger guard_time_correction_timeline_revision before insert on public.time_correction_applications
for each row execute function app_private.guard_time_correction_timeline_revision();

-- Both snapshots matter: moving time out of a window still suppresses its
-- original source there. Interval intersection also includes overnight facts
-- whose endpoints lie outside the requested window.
create function public.read_time_correction_applications(
  p_organization_id uuid,
  p_user_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns setof public.time_correction_applications
language sql stable security invoker set search_path = '' as $$
  select application.* from public.time_correction_applications application
  where application.organization_id = p_organization_id
    and (
      (p_user_ids is null and p_from is null and p_to is null)
      or exists (
        select 1 from (
          select 'before' as snapshot, fact from jsonb_array_elements(application.before_snapshot -> 'facts') fact
          union all
          select 'after', fact from jsonb_array_elements(application.applied_snapshot -> 'facts') fact
        ) facts
        where p_user_ids is null or (fact ->> 'userId')::uuid = any(p_user_ids)
        group by snapshot, fact ->> 'userId'
        having (p_to is null or min((fact ->> 'timestamp')::timestamptz) <= p_to)
          and (p_from is null or max((fact ->> 'timestamp')::timestamptz) >= p_from)
      )
    );
$$;
revoke all on function public.read_time_correction_applications(uuid, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.read_time_correction_applications(uuid, uuid[], timestamptz, timestamptz) to service_role;
