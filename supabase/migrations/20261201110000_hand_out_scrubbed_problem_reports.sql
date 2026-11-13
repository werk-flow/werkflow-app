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
-- Each scrubbed copy records the version of the scrub rules that wrote it;
-- only a copy at the current version leaves.
--
-- Prevention: Tier 1 (the claim, the hand-out's history entry, the rule
-- version, the Agent's limits in the triage function), Tier 2
-- supabase/tests/problem_report_handout.sql.

-- When a report thread first received the copy. Set once; a report with it
-- is no longer waiting for a thread.
alter table public.problem_reports add column handed_out_at timestamptz;
-- Whether the Agent wrote the current answer. Support's next answer clears it.
alter table public.problem_reports add column response_by_agent boolean not null default false;
-- @destructive: after release acce7e96: no row of that build has the flag set, so every row passes
alter table public.problem_reports add constraint problem_reports_agent_response_consistency
  check (not response_by_agent or response is not null);

-- The version of the scrub rules that wrote the copy
-- (lib/problem-reports/scrub/scrub-report.ts, SCRUB_RULES_VERSION). A copy
-- written before versions has none. Only a copy at the current version is
-- waiting or handed out; the daily run scrubs an older one again from its
-- originals while they exist.
alter table public.problem_reports add column scrub_version integer;
-- @destructive: after release acce7e96: no row of that build has a version, so every row passes
alter table public.problem_reports add constraint problem_reports_scrub_version_consistency
  check (scrub_version is null or (scrub_state = 'bereinigt' and scrub_version > 0));

-- The reports waiting for a thread, oldest first.
create index problem_reports_waiting_idx on public.problem_reports (created_at, id)
  where scrub_state = 'bereinigt' and handed_out_at is null and closed_at is null;

-- Writes the outcome of one scrub with the version of the rules that wrote
-- it, and returns the state the report has then: `bereinigt`,
-- `nicht_bereinigbar`, or `veraltet` when the report keeps a copy of an
-- older version because this scrub failed. A copy is written over only by a
-- copy of a newer version, so a failed scrub never removes a copy and an
-- older run never replaces a newer copy. The server resolved the
-- organization; a report of another organization reads as `report_not_found`.
-- The four-argument form stays for the build before this one, whose copies
-- carry no version and are scrubbed again.
create function public.record_problem_report_scrub(
  p_organization_id uuid,
  p_report_id uuid,
  p_scrubbed_description text,
  p_scrubbed_context jsonb,
  p_scrub_version integer
)
returns text
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_state text;
  v_version integer;
begin
  if (p_scrubbed_description is null) <> (p_scrubbed_context is null) then
    raise exception 'scrubbed_copy_incomplete';
  end if;
  if p_scrub_version is null or p_scrub_version < 1 then raise exception 'scrub_version_invalid'; end if;
  update public.problem_reports report
  set scrubbed_description = p_scrubbed_description,
      scrubbed_context = p_scrubbed_context,
      scrub_state = case when p_scrubbed_description is null then 'nicht_bereinigbar' else 'bereinigt' end,
      scrub_version = case when p_scrubbed_description is null then null else p_scrub_version end
  where report.id = p_report_id and report.organization_id = p_organization_id
    and (report.scrub_state <> 'bereinigt'
      or (p_scrubbed_description is not null and coalesce(report.scrub_version, 0) < p_scrub_version));
  select report.scrub_state, report.scrub_version into v_state, v_version from public.problem_reports report
  where report.id = p_report_id and report.organization_id = p_organization_id;
  if not found then raise exception 'report_not_found'; end if;
  return case when v_state = 'bereinigt' and coalesce(v_version, 0) < p_scrub_version
    then 'veraltet' else v_state end;
end;
$$;

revoke all on function public.record_problem_report_scrub(uuid, uuid, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.record_problem_report_scrub(uuid, uuid, text, jsonb, integer) to service_role;

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
-- writers who change different fields overwrite nothing of each other.
-- p_expected names, for exactly those keys, the value each change was based
-- on; a field that holds another value by now is `triage_conflict`. Every
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
-- copy, the scrubbed context, status, bucket, whether an answer exists (never
-- its text, which support wrote unscrubbed) and whether a redrawn screenshot exists;
-- never an original, a name or another id. A report sent less than ten
-- minutes ago, still waiting for its scrub, or whose copy predates the rules of
-- p_scrub_version while it keeps its originals, is `copy_pending`; one that
-- cannot be scrubbed, or keeps such a copy without originals, `copy_unavailable`, a closed one `report_closed`, one
-- already handed out `already_handed_out`, and a report of another
-- organization `report_not_found`.
create function public.hand_out_problem_report(
  p_organization_id uuid,
  p_report_id uuid,
  p_scrub_version integer,
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
  -- The device uploads the screenshot after the save, so a report waits ten
  -- minutes before a thread may take it; lib/problem-reports/handout.ts lists
  -- it from the same moment.
  if v_report.scrub_state = 'ausstehend' or v_report.created_at > now() - interval '10 minutes'
  then raise exception 'copy_pending'; end if;
  if v_report.scrub_state <> 'bereinigt' then raise exception 'copy_unavailable'; end if;
  -- A copy of older rules waits for the daily run to scrub it again; without
  -- its originals it never leaves.
  if coalesce(v_report.scrub_version, 0) < p_scrub_version then
    raise exception '%', case when v_report.originals_deleted_at is null then 'copy_pending' else 'copy_unavailable' end;
  end if;
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
    'has_answer', v_report.response is not null,
    'has_screenshot', exists (
      select 1 from public.problem_report_files file
      where file.report_id = p_report_id and file.organization_id = p_organization_id
        and file.kind = 'screenshot'
    )
  );
end;
$$;

revoke all on function public.hand_out_problem_report(uuid, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.hand_out_problem_report(uuid, uuid, integer, uuid[]) to service_role;

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
