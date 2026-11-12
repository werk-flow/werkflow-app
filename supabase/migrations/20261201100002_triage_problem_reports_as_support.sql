-- WerkFlow support triages problem reports (werk-flow/werkflow-planning#335,
-- part of #21). Support sets a report's bucket, status, assignee and answer in
-- one function call, which writes one history entry per changed field. Support
-- files a report for a member who phoned: the member is the reporter, the
-- support person the filer. The reporter's „Meine Meldungen“ and the other
-- support persons' open pages follow live through signal rows that hold no
-- report content.
--
-- Support is no organization role. The server admits a support person from
-- its allowlist (lib/support/allowlist.ts) before it calls a function here;
-- every function is executable by the service role only.
--
-- Prevention: Tier 1 (the triage function's history, the membership check of
-- a report filed for a caller, the opening's history entry, the signal's
-- own-row policy), Tier 2
-- supabase/tests/problem_report_support.sql.

-- The support person who works on the report. A deleted account empties it.
alter table public.problem_reports
  add column assignee_id uuid references public.profiles (id) on delete set null;
create index problem_reports_assignee_idx on public.problem_reports (assignee_id)
  where assignee_id is not null;
-- The support queue reads every organization's reports oldest first.
create index problem_reports_queue_idx on public.problem_reports (created_at, id);

-- The live signal of a person: one row per person and organization, touched
-- when a report of that organization changes for them. The reporter's row
-- moves when support changes what the reporter reads; a support person's row
-- moves when another support person triages, opens an original or files a
-- report. It names no report and carries no content; the page reads again
-- through the server. Only its own person selects a row, so Realtime delivers
-- it to nobody else. The server names the support persons, because the
-- allowlist is a server setting.
create table public.problem_report_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index problem_report_signals_user_idx on public.problem_report_signals (user_id);

alter table public.problem_report_signals enable row level security;
create policy problem_report_signals_select_own on public.problem_report_signals
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on table public.problem_report_signals from public, anon, authenticated, service_role;
grant select on table public.problem_report_signals to authenticated;
grant select, insert, update on table public.problem_report_signals to service_role;

create unique index problem_report_signals_replident_idx
  on public.problem_report_signals (id, organization_id);
alter table public.problem_report_signals
  replica identity using index problem_report_signals_replident_idx;
-- No deletion notice: a notice reaches every member of the organization, and
-- a signal row belongs to one person. A row leaves only with its person's
-- profile or its organization, and no open view needs to hear of that.
-- lib/realtime/tables.ts lists the table as own-user, and realtime:check
-- refuses the deletion trigger on it.
alter publication supabase_realtime add table public.problem_report_signals;

-- Touches the signal row of each named person in the organization. An id
-- without a profile, such as a stale allowlist entry, is skipped.
create function app_private.signal_problem_report_users(p_organization_id uuid, p_user_ids uuid[])
returns void
language sql
security invoker
set search_path to ''
as $$
  insert into public.problem_report_signals (organization_id, user_id)
  select p_organization_id, profile.id
  from public.profiles profile
  where profile.id = any (coalesce(p_user_ids, array[]::uuid[]))
  on conflict (organization_id, user_id) do update set updated_at = now();
$$;

revoke all on function app_private.signal_problem_report_users(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function app_private.signal_problem_report_users(uuid, uuid[]) to service_role;

-- Applies support's changes to one report: the keys `status`, `bucket`,
-- `assignee_id` and `response` of p_changes, each optional, so two support
-- persons who change different fields overwrite nothing of each other.
-- p_expected holds, for the same keys, the values the support person's page
-- showed when they began the change: a field that holds another value by now
-- refuses the whole write as `triage_conflict`, so a late write never
-- replaces a newer one unseen. A new assignee must still have an account
-- (`assignee_not_support`). Every
-- field that really changes writes one history entry with the actor; the
-- answer's text stays out of the history. Closing sets the closing time,
-- reopening clears it. A changed status or answer signals the reporter; any
-- change signals the support persons in p_support_ids. The server resolved
-- the actor as support; a report of another organization reads as
-- `report_not_found`.
create function public.triage_problem_report(
  p_organization_id uuid,
  p_report_id uuid,
  p_actor_id uuid,
  p_changes jsonb,
  p_expected jsonb,
  p_support_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_report public.problem_reports%rowtype;
  v_status text;
  v_bucket text;
  v_assignee_id uuid;
  v_response text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
    or p_changes - array['status', 'bucket', 'assignee_id', 'response'] <> '{}'::jsonb
    or (p_changes ? 'status' and jsonb_typeof(p_changes -> 'status') <> 'string')
    or p_expected is null or jsonb_typeof(p_expected) <> 'object'
    or (select coalesce(array_agg(field order by field), '{}') from jsonb_object_keys(p_changes) field)
      is distinct from
      (select coalesce(array_agg(field order by field), '{}') from jsonb_object_keys(p_expected) field)
  then raise exception 'invalid_triage'; end if;

  select * into v_report from public.problem_reports report
  where report.id = p_report_id and report.organization_id = p_organization_id
  for update;
  if not found then raise exception 'report_not_found'; end if;
  if (p_changes ? 'status' and v_report.status is distinct from p_expected ->> 'status')
    or (p_changes ? 'bucket' and v_report.bucket is distinct from p_expected ->> 'bucket')
    or (p_changes ? 'assignee_id'
      and v_report.assignee_id is distinct from (p_expected ->> 'assignee_id')::uuid)
    or (p_changes ? 'response' and v_report.response is distinct from p_expected ->> 'response')
  then raise exception 'triage_conflict'; end if;

  v_status := case when p_changes ? 'status' then p_changes ->> 'status' else v_report.status end;
  v_bucket := case when p_changes ? 'bucket' then p_changes ->> 'bucket' else v_report.bucket end;
  v_assignee_id := case when p_changes ? 'assignee_id'
    then (p_changes ->> 'assignee_id')::uuid else v_report.assignee_id end;
  v_response := case when p_changes ? 'response' then p_changes ->> 'response' else v_report.response end;
  if v_assignee_id is distinct from v_report.assignee_id and v_assignee_id is not null
    and not exists (select 1 from public.profiles profile where profile.id = v_assignee_id)
  then raise exception 'assignee_not_support'; end if;

  update public.problem_reports report
  set status = v_status,
      bucket = v_bucket,
      assignee_id = v_assignee_id,
      response = v_response,
      closed_at = case when v_status in ('erledigt', 'abgelehnt')
        then coalesce(report.closed_at, now()) end
  where report.id = p_report_id and report.organization_id = p_organization_id;

  insert into public.problem_report_events (organization_id, report_id, event_type, actor_id, payload)
  select p_organization_id, p_report_id, change.event_type, p_actor_id, change.payload
  from (values
    ('status_changed', v_status is distinct from v_report.status,
      jsonb_build_object('from', v_report.status, 'to', v_status)),
    ('bucket_changed', v_bucket is distinct from v_report.bucket,
      jsonb_build_object('from', v_report.bucket, 'to', v_bucket)),
    ('assignee_changed', v_assignee_id is distinct from v_report.assignee_id,
      jsonb_build_object('from', v_report.assignee_id, 'to', v_assignee_id)),
    ('response_changed', v_response is distinct from v_report.response, '{}'::jsonb)
  ) as change (event_type, changed, payload)
  where change.changed;

  if v_status is distinct from v_report.status or v_response is distinct from v_report.response then
    perform app_private.signal_problem_report_users(p_organization_id, array[v_report.reporter_id]);
  end if;
  if v_status is distinct from v_report.status or v_bucket is distinct from v_report.bucket
    or v_assignee_id is distinct from v_report.assignee_id or v_response is distinct from v_report.response
  then
    perform app_private.signal_problem_report_users(p_organization_id, p_support_ids);
  end if;
end;
$$;

revoke all on function public.triage_problem_report(uuid, uuid, uuid, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.triage_problem_report(uuid, uuid, uuid, jsonb, jsonb, uuid[]) to service_role;

-- Stores a report support files for a member who phoned: the member is the
-- reporter, the support person the filer, and the report has no captured
-- context, because no device sent it. The member must belong to the
-- organization. It saves once under the id the support person's device chose,
-- as submit_problem_report does, and starts with its scrubbed copy pending.
-- The new report signals the reporter and the support persons in p_support_ids.
create function public.file_problem_report_for_caller(
  p_report_id uuid,
  p_organization_id uuid,
  p_reporter_id uuid,
  p_actor_id uuid,
  p_description text,
  p_support_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_report record;
  v_stored integer;
begin
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_reporter_id
  ) then raise exception 'reporter_not_member'; end if;

  insert into public.problem_reports (id, organization_id, reporter_id, filed_by_id, description, context)
  values (p_report_id, p_organization_id, p_reporter_id, p_actor_id, p_description, '{}'::jsonb)
  on conflict (id) do nothing;
  get diagnostics v_stored = row_count;
  select report.number, report.organization_id, report.reporter_id, report.filed_by_id into v_report
  from public.problem_reports report
  where report.id = p_report_id;
  if v_report.organization_id is distinct from p_organization_id
    or v_report.reporter_id is distinct from p_reporter_id
    or v_report.filed_by_id is distinct from p_actor_id
  then raise exception 'report_conflict'; end if;
  if v_stored > 0 then
    perform app_private.signal_problem_report_users(p_organization_id, array[p_reporter_id]);
    perform app_private.signal_problem_report_users(p_organization_id, p_support_ids);
  end if;
  return v_report.number;
end;
$$;

revoke all on function public.file_problem_report_for_caller(uuid, uuid, uuid, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.file_problem_report_for_caller(uuid, uuid, uuid, uuid, text, uuid[])
  to service_role;

-- Records that support opened a report's original, or one attachment of it
-- when p_file_id names one, and signals the support persons in
-- p_support_ids. The server calls it before the original leaves, and hands
-- out nothing when it fails. A report of another organization reads as
-- `report_not_found`.
create function public.record_problem_report_opening(
  p_organization_id uuid,
  p_report_id uuid,
  p_actor_id uuid,
  p_file_id uuid,
  p_support_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.problem_reports report
    where report.id = p_report_id and report.organization_id = p_organization_id
  ) then raise exception 'report_not_found'; end if;
  insert into public.problem_report_events (organization_id, report_id, event_type, actor_id, payload)
  values (
    p_organization_id, p_report_id, 'original_opened', p_actor_id,
    case when p_file_id is null then '{}'::jsonb else jsonb_build_object('file_id', p_file_id) end
  );
  perform app_private.signal_problem_report_users(p_organization_id, p_support_ids);
end;
$$;

revoke all on function public.record_problem_report_opening(uuid, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.record_problem_report_opening(uuid, uuid, uuid, uuid, uuid[]) to service_role;
