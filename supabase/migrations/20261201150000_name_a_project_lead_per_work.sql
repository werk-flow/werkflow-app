-- A project lead („Projektleitung“) per project or job
-- (werk-flow/werkflow-planning#381).
--
-- A project lead is a scoped responsibility, not a role: the member keeps
-- their role (admin, buero or employee). Admin and Büro name one member as the
-- lead of a project or of a job and end it. A project's lead covers its jobs
-- unless a job names its own. This step holds the record, the rule and the
-- review; the office's naming and ending functions come with their screen.
--
-- 1. work_leads: one row per lead holding. Only its end and who ended it are
--    set, once, so the rows are the history. One open lead per project and
--    per job. No delete removes a holding but its organization's, and a
--    project or job with one refuses its hard deletion as work with history.
-- 2. app_private.work_lead_scope: the one rule for „is this member the lead
--    of this work“. A lead counts while the holding is open, the member still
--    belongs to the organization with effective access and has not left.
--    public.read_work_lead_scope hands the same rows to the server
--    (lib/responsibilities/work-lead.ts).
-- 3. record_work_artifact_action_p1_17_inner: the lead of the work may
--    approve, reject or send back a Regie- oder Änderungsnachweis
--    (kind change_work) of it, besides the work_artifact_approval holders.
--    The four-eyes rule against the revision's author stays.
--
-- Division of work: the server actions establish identity and organization
-- and pass them; the review function checks the lead rule again.
--
-- Expand-only: the previous release reads and writes none of the new objects;
-- its review action never names a lead, so the widened check never meets it.
--
-- Prevention: Tier 1 (constraints, trigger, function checks), Tier 2
-- supabase/tests/work_leads.sql.

-- 1. Lead holdings.
create table public.work_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid,
  job_id uuid,
  employee_record_id uuid not null,
  started_at timestamptz not null default now(),
  started_by uuid references auth.users (id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_leads_target_check check (num_nonnulls(project_id, job_id) = 1),
  constraint work_leads_project_fk foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  constraint work_leads_job_fk foreign key (job_id, organization_id)
    references public.jobs (id, organization_id) on delete cascade,
  constraint work_leads_employee_fk foreign key (employee_record_id, organization_id)
    references public.employee_records (id, organization_id) on delete cascade,
  constraint work_leads_range_check check (ended_at is null or ended_at >= started_at),
  constraint work_leads_end_actor_check check (ended_at is not null or ended_by is null)
);

create unique index work_leads_replident_idx on public.work_leads (id, organization_id);
create unique index work_leads_one_open_per_project on public.work_leads (project_id)
  where ended_at is null and project_id is not null;
create unique index work_leads_one_open_per_job on public.work_leads (job_id)
  where ended_at is null and job_id is not null;
create index work_leads_project_fk_idx on public.work_leads (project_id, organization_id);
create index work_leads_job_fk_idx on public.work_leads (job_id, organization_id);
create index work_leads_employee_fk_idx on public.work_leads (employee_record_id, organization_id);
create index work_leads_started_by_fk_idx on public.work_leads (started_by);
create index work_leads_ended_by_fk_idx on public.work_leads (ended_by);

alter table public.work_leads enable row level security;
-- A session reads the rows only to hear of a change: a manager of the
-- organization, and the lead of their own holding. The server reads and
-- writes them.
create policy "Managers and the lead can view work leads" on public.work_leads
  for select to authenticated
  using (
    organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
    or employee_record_id in (select app_private.get_user_employee_record_ids((select auth.uid())))
  );
revoke all on table public.work_leads from public, anon, authenticated, service_role;
grant select on table public.work_leads to authenticated;
grant select, insert, update on table public.work_leads to service_role;

create trigger work_leads_updated_at before update on public.work_leads
  for each row execute function update_updated_at_column();

alter table public.work_leads replica identity using index work_leads_replident_idx;
alter publication supabase_realtime add table public.work_leads;
create trigger emit_realtime_deletion after delete on public.work_leads
  for each row execute function app_private.emit_realtime_deletion();

-- A holding is history: only its end and who ended it are set, once. A
-- deleted account clears its actor.
create function app_private.guard_work_lead_history()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.job_id is distinct from old.job_id
    or new.employee_record_id is distinct from old.employee_record_id
    or new.started_at is distinct from old.started_at
    or new.created_at is distinct from old.created_at
    or (new.started_by is distinct from old.started_by and new.started_by is not null)
    or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
    or (new.ended_by is distinct from old.ended_by and new.ended_by is not null
      and (old.ended_at is not null or new.ended_at is null))
  then
    raise exception 'work_lead_history_immutable';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_work_lead_history() from public, anon, authenticated;

create trigger guard_work_lead_history before update on public.work_leads
  for each row execute function app_private.guard_work_lead_history();

-- No delete removes a holding, direct or by the cascade of its project, job
-- or person; only its organization's deletion does. The organization
-- teardown is recognised as in app_private.prevent_historic_work_delete:
-- inside a cascade, for an organization app.deleting_organization_ids names.
create function app_private.prevent_work_lead_delete()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if pg_trigger_depth() > 1 and old.organization_id::text = any (
    string_to_array(current_setting('app.deleting_organization_ids', true), ',')
  ) then return old; end if;
  raise exception 'work_lead_history_immutable';
end;
$$;
revoke all on function app_private.prevent_work_lead_delete() from public, anon, authenticated;

create trigger prevent_work_lead_delete before delete on public.work_leads
  for each row execute function app_private.prevent_work_lead_delete();

-- Work with a lead holding is work with history: its hard deletion is refused
-- with the reason the office already sees. Unchanged from
-- 20261130090003_attach_a_request_to_existing_work.sql but for the holdings.
create or replace function app_private.prevent_historic_work_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if pg_trigger_depth() > 1 and old.organization_id::text = any (
    string_to_array(current_setting('app.deleting_organization_ids', true), ',')
  ) then return old; end if;

  if tg_table_name = 'jobs' and (
    exists (select 1 from public.work_execution_events event where event.job_id = old.id)
    or exists (select 1 from public.work_blockers blocker where blocker.job_id = old.id)
    or exists (select 1 from public.work_dependencies dependency
      where dependency.dependent_job_id = old.id or dependency.predecessor_job_id = old.id)
    or exists (select 1 from public.work_artifacts artifact where artifact.job_id = old.id)
    or exists (select 1 from public.work_request_entries entry where entry.job_id = old.id)
    or exists (select 1 from public.work_leads lead where lead.job_id = old.id)
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;

  if tg_table_name = 'projects' and (
    exists (select 1 from public.work_execution_events event where event.project_id = old.id)
    or exists (select 1 from public.work_blockers blocker where blocker.project_id = old.id)
    or exists (select 1 from public.work_dependencies dependency
      where dependency.dependent_project_id = old.id or dependency.predecessor_project_id = old.id)
    or exists (select 1 from public.work_artifacts artifact where artifact.project_id = old.id)
    or exists (select 1 from public.work_request_entries entry where entry.project_id = old.id)
    or exists (select 1 from public.work_leads lead where lead.project_id = old.id)
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;
  return old;
end;
$function$;

-- 2. The lead rule. Rows (project_id, null) for each project the member
-- leads; rows (project_id or null, job_id) for each job they lead, by its own
-- holding or through its project's.
create function app_private.work_lead_scope(p_organization_id uuid, p_user_id uuid)
returns table (project_id uuid, job_id uuid)
language sql
stable
security definer
set search_path to ''
as $$
  with lead as (
    select work_lead.project_id, work_lead.job_id
    from public.work_leads work_lead
    join public.employee_records employee
      on employee.id = work_lead.employee_record_id
     and employee.organization_id = work_lead.organization_id
    join public.organization_members member
      on member.organization_id = employee.organization_id
     and member.user_id = employee.user_id
    where work_lead.organization_id = p_organization_id
      and work_lead.ended_at is null
      and employee.user_id = p_user_id
      and (employee.exit_date is null
        or employee.exit_date >= (now() at time zone 'Europe/Berlin')::date)
      and app_private.p1_24_has_effective_access(p_organization_id, p_user_id)
  )
  select lead.project_id, null::uuid
  from lead
  where lead.project_id is not null
  union all
  select job.project_id, job.id
  from lead
  join public.jobs job on job.id = lead.job_id and job.organization_id = p_organization_id
  union all
  select job.project_id, job.id
  from lead
  join public.jobs job on job.project_id = lead.project_id and job.organization_id = p_organization_id
  where not exists (
    select 1 from public.work_leads own_lead
    where own_lead.job_id = job.id and own_lead.ended_at is null
  );
$$;
revoke all on function app_private.work_lead_scope(uuid, uuid) from public, anon, authenticated;

-- Whether the member leads the job, or, for project-level work (no job), the
-- project.
create function app_private.is_work_lead(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from app_private.work_lead_scope(p_organization_id, p_user_id) scope
    where (p_job_id is not null and scope.job_id = p_job_id)
      or (p_job_id is null and p_project_id is not null
        and scope.job_id is null and scope.project_id = p_project_id)
  );
$$;
revoke all on function app_private.is_work_lead(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Whether the actor may review the Arbeitsnachweis as the lead of its work:
-- only a Regie- oder Änderungsnachweis (kind change_work).
create function app_private.is_work_artifact_lead_reviewer(p_artifact_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.work_artifacts artifact
    where artifact.id = p_artifact_id
      and artifact.kind = 'change_work'
      and app_private.is_work_lead(artifact.organization_id, artifact.job_id, artifact.project_id, p_actor_id)
  );
$$;
revoke all on function app_private.is_work_artifact_lead_reviewer(uuid, uuid) from public, anon, authenticated;

-- The same rule for the server, as one value: {"projectIds": [...],
-- "jobIds": [...]}, so no row cap can cut it short.
create function public.read_work_lead_scope(p_organization_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'projectIds', coalesce(jsonb_agg(scope.project_id) filter (where scope.job_id is null), '[]'::jsonb),
    'jobIds', coalesce(jsonb_agg(scope.job_id) filter (where scope.job_id is not null), '[]'::jsonb)
  )
  from app_private.work_lead_scope(p_organization_id, p_user_id) scope;
$$;
revoke all on function public.read_work_lead_scope(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_work_lead_scope(uuid, uuid) to service_role;

-- 3. The lead's review, in the action function and in the ledger's guard.
-- The action function is unchanged from
-- 20261108000000_keep_internal_drafts_with_their_author.sql except for
-- v_lead_review: a review step on a Regie- oder Änderungsnachweis by the
-- lead of its work passes the target and the responsibility check. The guard
-- follows below.
create or replace function public.record_work_artifact_action_p1_17_inner(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_action_id uuid,
  p_expected_version bigint,
  p_action_type public.work_artifact_action_type,
  p_reason text,
  p_comment text,
  p_responsibility_snapshot jsonb,
  p_customer_context jsonb,
  p_signature_document_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_revision public.work_artifact_revisions%rowtype;
  v_existing public.work_artifact_actions%rowtype;
  v_status public.work_artifact_status;
  v_version bigint;
  v_lead_review boolean;
begin
  select * into v_existing from public.work_artifact_actions action where action.id = p_action_id;
  if found then
    if v_existing.artifact_id <> p_artifact_id or v_existing.revision_id <> p_revision_id
      or v_existing.action_type <> p_action_type then
      raise exception 'work_artifact_action_idempotency_conflict';
    end if;
    select * into v_artifact from public.work_artifacts artifact where artifact.id = p_artifact_id;
    return jsonb_build_object('actionId', p_action_id, 'version', v_artifact.version,
      'status', v_artifact.status, 'duplicate', true);
  end if;

  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided' then raise exception 'work_artifact_is_voided'; end if;
  if v_artifact.version is distinct from p_expected_version then
    raise exception 'work_artifact_stale_version';
  end if;
  if v_artifact.current_revision_id is distinct from p_revision_id then
    raise exception 'work_artifact_action_requires_current_revision';
  end if;
  v_lead_review := p_action_type in ('internal_approved', 'internal_rejected', 'correction_requested')
    and app_private.is_work_artifact_lead_reviewer(p_artifact_id, p_actor_id);
  if not v_lead_review and not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = p_revision_id and revision.artifact_id = p_artifact_id;

  if p_action_type = 'review_requested'
    and v_artifact.status = 'draft'
    and v_revision.visibility = 'internal_only'
    and v_revision.created_by <> p_actor_id
    and not app_private.is_work_artifact_manager(p_organization_id, p_actor_id)
  then raise exception 'work_artifact_not_authorized'; end if;

  if p_action_type in ('internal_approved', 'internal_rejected', 'correction_requested') then
    if v_revision.created_by = p_actor_id then raise exception 'work_artifact_self_approval_not_allowed'; end if;
    if not v_lead_review and not app_private.work_artifact_actor_can_approve(p_organization_id, p_actor_id) then
      raise exception 'work_artifact_not_responsible';
    end if;
  end if;

  if p_action_type in (
    'customer_acknowledged', 'customer_refused', 'customer_reserved', 'signature_captured'
  ) and v_revision.visibility <> 'customer_facing' then
    raise exception 'work_artifact_customer_action_requires_customer_visibility';
  end if;

  if p_action_type = 'review_requested' then
    if v_artifact.status not in ('draft', 'rejected', 'correction_requested')
    then raise exception 'work_artifact_review_state_invalid'; end if;
    perform app_private.validate_submitted_work_artifact_revision(p_revision_id);
    v_status := 'submitted';
  elsif p_action_type = 'review_withdrawn' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    if not app_private.is_work_artifact_manager(p_organization_id, p_actor_id)
      and not exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = p_revision_id and action.action_type = 'review_requested'
          and action.created_by = p_actor_id
      ) then raise exception 'work_artifact_review_withdraw_not_authorized'; end if;
    v_status := 'draft';
  elsif p_action_type = 'internal_approved' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    v_status := 'approved';
  elsif p_action_type = 'internal_rejected' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    v_status := 'rejected';
  elsif p_action_type = 'correction_requested' then
    v_status := 'correction_requested';
  else
    v_status := v_artifact.status;
  end if;

  if p_action_type = 'signature_captured' then
    insert into public.work_artifact_revision_documents (
      id, organization_id, revision_id, document_id, relation, description, created_by
    ) values (
      p_action_id, p_organization_id, p_revision_id, p_signature_document_id,
      'signature_mark', 'Erfasste Unterschrift', p_actor_id
    ) on conflict (revision_id, document_id, relation) do nothing;
  end if;

  insert into public.work_artifact_actions (
    id, organization_id, artifact_id, revision_id, action_type, reason, comment,
    responsibility_snapshot, signer_name, signer_role, signer_relationship,
    signer_company_context, capture_method, wording_snapshot, witness_context,
    signature_document_id, created_by
  ) values (
    p_action_id, p_organization_id, p_artifact_id, p_revision_id, p_action_type,
    nullif(btrim(p_reason), ''), nullif(btrim(p_comment), ''), p_responsibility_snapshot,
    nullif(btrim(p_customer_context->>'signerName'), ''),
    nullif(btrim(p_customer_context->>'signerRole'), ''),
    nullif(btrim(p_customer_context->>'signerRelationship'), ''),
    nullif(btrim(p_customer_context->>'companyContext'), ''),
    nullif(btrim(p_customer_context->>'captureMethod'), ''),
    nullif(btrim(p_customer_context->>'wordingSnapshot'), ''),
    nullif(btrim(p_customer_context->>'witnessContext'), ''),
    p_signature_document_id, p_actor_id
  );

  v_version := v_artifact.version + 1;
  update public.work_artifacts set status = v_status, version = v_version, updated_at = now()
  where id = p_artifact_id;
  return jsonb_build_object('actionId', p_action_id, 'version', v_version,
    'status', v_status, 'duplicate', false);
end;
$$;

-- The ledger guard, unchanged from
-- 20261126090000_record_customer_decision_with_signature.sql except that the
-- lead of the work passes the responsibility check on a review step of a
-- Regie- oder Änderungsnachweis.
create or replace function app_private.guard_work_artifact_manager_action()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
begin
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = new.artifact_id and artifact.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided'
  then raise exception 'work_artifact_is_voided'; end if;
  if new.action_type in ('customer_acknowledged', 'customer_refused', 'customer_reserved')
    and exists (
      select 1 from public.work_artifact_actions action
      where action.revision_id = new.revision_id
        and action.action_type in ('customer_acknowledged', 'customer_refused', 'customer_reserved')
    )
  then raise exception 'work_artifact_customer_decision_recorded'; end if;
  if new.action_type = 'signature_captured'
    and exists (
      select 1 from public.work_artifact_actions action
      where action.revision_id = new.revision_id and action.action_type = 'signature_captured'
    )
  then raise exception 'work_artifact_customer_decision_recorded'; end if;
  if new.action_type = 'signature_captured' then
    insert into public.work_artifact_revision_documents (
      id, organization_id, revision_id, document_id, relation, description, created_by
    ) values (
      new.id, new.organization_id, new.revision_id, new.signature_document_id,
      'signature_mark', 'Erfasste Unterschrift', new.created_by
    ) on conflict (revision_id, document_id, relation) do nothing;
  end if;
  if new.action_type = 'review_requested'
    and (v_artifact.status not in ('draft', 'rejected', 'correction_requested', 'submitted')
      or (v_artifact.status = 'submitted' and exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = new.revision_id and action.action_type = 'review_requested'
      )))
  then raise exception 'work_artifact_review_state_invalid'; end if;
  if new.action_type in (
    'customer_acknowledged', 'customer_refused', 'customer_reserved',
    'signature_captured', 'exported'
  ) and not app_private.can_access_work_artifact_target(
    new.organization_id, v_artifact.job_id, v_artifact.project_id, new.created_by
  ) then raise exception 'work_artifact_not_authorized'; end if;
  if new.action_type in ('internal_approved', 'internal_rejected', 'correction_requested') then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    if exists (
      select 1 from public.work_artifact_revisions revision
      where revision.id = new.revision_id and revision.created_by = new.created_by
    ) then raise exception 'work_artifact_self_approval_not_allowed'; end if;
    if not app_private.work_artifact_actor_can_approve(new.organization_id, new.created_by)
      and not app_private.is_work_artifact_lead_reviewer(new.artifact_id, new.created_by)
    then raise exception 'work_artifact_not_responsible'; end if;
  end if;
  if new.action_type = 'review_withdrawn'
    and not app_private.is_work_artifact_manager(new.organization_id, new.created_by)
    and not exists (
      select 1 from public.work_artifact_actions action
      where action.revision_id = new.revision_id and action.action_type = 'review_requested'
        and action.created_by = new.created_by
    ) then raise exception 'work_artifact_review_withdraw_not_authorized'; end if;
  if new.action_type = 'voided'
    and not app_private.is_work_artifact_manager(new.organization_id, new.created_by)
    and (v_artifact.status <> 'draft' or v_artifact.created_by <> new.created_by
      or exists (
        select 1 from public.work_artifact_actions action
        where action.artifact_id = new.artifact_id
      ))
  then raise exception 'work_artifact_void_not_authorized'; end if;
  return new;
end;
$$;
