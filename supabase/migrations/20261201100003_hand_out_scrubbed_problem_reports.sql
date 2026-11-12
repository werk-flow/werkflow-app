-- Report threads receive the scrubbed copy of a problem report, by id, and
-- write its status back (werk-flow/werkflow-planning#336, part of #21). The
-- route handlers under app/api/problem-reports/v1/ hold a dedicated secret,
-- load the report by id and call these functions with its organization; every
-- function is executable by the service role only.
--
-- The thread is the Agent: no user, so its history entries carry no actor id.
-- The first hand-out of a report's copy claims the report, so no report
-- starts two threads, and each hand-out is a history entry written in the
-- same call, before the copy leaves the server. The Agent's write-back is a
-- triage without an actor; an answer it wrote is marked, so the reporter and
-- support see that it was written automatically.
--
-- Prevention: Tier 1 (the claim, the hand-out's history entry, the Agent's
-- limits in the triage function), Tier 2 supabase/tests/problem_report_handout.sql.

-- When a report thread first received the copy. Set once; a report with it
-- is no longer waiting for a thread.
alter table public.problem_reports add column handed_out_at timestamptz;
-- Whether the Agent wrote the current answer. Support's next answer clears it.
alter table public.problem_reports add column response_by_agent boolean not null default false;
-- @destructive: after release acce7e96: no row of that build has the flag set, so every row passes
alter table public.problem_reports add constraint problem_reports_agent_response_consistency
  check (not response_by_agent or response is not null);

-- The reports waiting for a thread, oldest first.
create index problem_reports_waiting_idx on public.problem_reports (created_at, id)
  where scrub_state = 'bereinigt' and handed_out_at is null and closed_at is null;

-- The Agent acts without an actor id, and only on what a triage changes and
-- on hand-outs; an opening and an assignee change always name a person.
alter table public.problem_report_events alter column actor_id drop not null;
-- @destructive: after release acce7e96: the replacement below widens the event types; that build writes only the types it keeps
alter table public.problem_report_events drop constraint problem_report_events_event_type_check;
-- @destructive: after release acce7e96: widens the event types by the two hand-outs; that build writes only the types it keeps
alter table public.problem_report_events add constraint problem_report_events_event_type_check
  check (event_type in (
    'status_changed', 'bucket_changed', 'assignee_changed', 'response_changed', 'original_opened',
    'copy_handed_out', 'screenshot_handed_out'
  ));
-- @destructive: after release acce7e96: every row of that build names its actor, so every row passes
alter table public.problem_report_events add constraint problem_report_events_agent_actor
  check (actor_id is not null or event_type in (
    'status_changed', 'bucket_changed', 'response_changed', 'copy_handed_out', 'screenshot_handed_out'
  ));

-- Applies support's or the Agent's changes to one report: the keys `status`,
-- `bucket`, `assignee_id` and `response` of p_changes, each optional, so two
-- writers who change different fields overwrite nothing of each other. Every
-- field that really changes writes one history entry with the actor; the
-- answer's text stays out of the history. Closing sets the closing time,
-- reopening clears it. A changed status or answer signals the reporter; any
-- change signals the support persons in p_support_ids. The server resolved
-- the actor as support, or passes no actor for the Agent. The Agent changes
-- only a report it received, sets no assignee and clears no field, and its
-- answer is marked as its own. A report of another organization reads as
-- `report_not_found`.
create or replace function public.triage_problem_report(
  p_organization_id uuid,
  p_report_id uuid,
  p_actor_id uuid,
  p_changes jsonb,
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
    or (p_actor_id is null and (
      p_changes = '{}'::jsonb or p_changes ? 'assignee_id'
      or exists (select 1 from jsonb_each(p_changes) change where jsonb_typeof(change.value) <> 'string')
    ))
  then raise exception 'invalid_triage'; end if;

  select * into v_report from public.problem_reports report
  where report.id = p_report_id and report.organization_id = p_organization_id
  for update;
  if not found then raise exception 'report_not_found'; end if;
  if p_actor_id is null and v_report.handed_out_at is null then raise exception 'report_not_handed_out'; end if;

  v_status := case when p_changes ? 'status' then p_changes ->> 'status' else v_report.status end;
  v_bucket := case when p_changes ? 'bucket' then p_changes ->> 'bucket' else v_report.bucket end;
  v_assignee_id := case when p_changes ? 'assignee_id'
    then (p_changes ->> 'assignee_id')::uuid else v_report.assignee_id end;
  v_response := case when p_changes ? 'response' then p_changes ->> 'response' else v_report.response end;

  update public.problem_reports report
  set status = v_status,
      bucket = v_bucket,
      assignee_id = v_assignee_id,
      response = v_response,
      response_by_agent = case when v_response is distinct from v_report.response
        then p_actor_id is null else report.response_by_agent end,
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

-- Hands one report's scrubbed copy to a report thread, once: the call claims
-- the report and writes the hand-out into the history before it answers, and
-- signals the support persons in p_support_ids. It answers one object: the
-- copy, the scrubbed context, status, bucket and whether a redrawn screenshot exists;
-- never an original, a name or another id. A report without a scrubbed copy
-- is `copy_pending` or `copy_unavailable`, a closed one `report_closed`, one
-- already handed out `already_handed_out`, and a report of another
-- organization `report_not_found`.
create function public.hand_out_problem_report(
  p_organization_id uuid,
  p_report_id uuid,
  p_support_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_report public.problem_reports%rowtype;
begin
  select * into v_report from public.problem_reports report
  where report.id = p_report_id and report.organization_id = p_organization_id
  for update;
  if not found then raise exception 'report_not_found'; end if;
  if v_report.scrub_state = 'ausstehend' then raise exception 'copy_pending'; end if;
  if v_report.scrub_state <> 'bereinigt' then raise exception 'copy_unavailable'; end if;
  if v_report.closed_at is not null then raise exception 'report_closed'; end if;
  if v_report.handed_out_at is not null then raise exception 'already_handed_out'; end if;

  update public.problem_reports report set handed_out_at = now()
  where report.id = p_report_id and report.organization_id = p_organization_id;
  insert into public.problem_report_events (organization_id, report_id, event_type, actor_id)
  values (p_organization_id, p_report_id, 'copy_handed_out', null);
  perform app_private.signal_problem_report_users(p_organization_id, p_support_ids);

  return jsonb_build_object(
    'description', v_report.scrubbed_description,
    'context', v_report.scrubbed_context,
    'status', v_report.status,
    'bucket', v_report.bucket,
    'has_screenshot', exists (
      select 1 from public.problem_report_files file
      where file.report_id = p_report_id and file.organization_id = p_organization_id
        and file.kind = 'screenshot'
    )
  );
end;
$$;

revoke all on function public.hand_out_problem_report(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.hand_out_problem_report(uuid, uuid, uuid[]) to service_role;

-- Hands the redrawn screenshot of a report whose copy a thread received:
-- writes the hand-out into the history, signals the support persons in
-- p_support_ids, and answers the screenshot's storage key and type for the
-- server to read. A report not handed out yet is `report_not_handed_out`, one
-- without a screenshot (or whose originals are deleted) `no_screenshot`, and
-- a report of another organization `report_not_found`.
create function public.hand_out_problem_report_screenshot(
  p_organization_id uuid,
  p_report_id uuid,
  p_support_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_handed_out_at timestamptz;
  v_path text;
  v_mime_type text;
begin
  select report.handed_out_at into v_handed_out_at from public.problem_reports report
  where report.id = p_report_id and report.organization_id = p_organization_id
  for update;
  if not found then raise exception 'report_not_found'; end if;
  if v_handed_out_at is null then raise exception 'report_not_handed_out'; end if;
  select file.storage_path, file.mime_type into v_path, v_mime_type from public.problem_report_files file
  where file.report_id = p_report_id and file.organization_id = p_organization_id and file.kind = 'screenshot';
  if v_path is null then raise exception 'no_screenshot'; end if;

  insert into public.problem_report_events (organization_id, report_id, event_type, actor_id)
  values (p_organization_id, p_report_id, 'screenshot_handed_out', null);
  perform app_private.signal_problem_report_users(p_organization_id, p_support_ids);
  return jsonb_build_object('path', v_path, 'mime_type', v_mime_type);
end;
$$;

revoke all on function public.hand_out_problem_report_screenshot(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.hand_out_problem_report_screenshot(uuid, uuid, uuid[]) to service_role;
