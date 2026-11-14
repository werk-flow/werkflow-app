-- A maintenance visit that ends partial or unresolved names its Mängel, the
-- next action and who owns it (werk-flow/werkflow-planning#470).
--
-- * public.complete_maintenance_visit completes a due item as before and, for
--   `partial` or `unresolved`, requires one to ten Mängel and a next action:
--   Rückkehr, Garantieprüfung or Austausch anbieten with an owner (an Admin or
--   Büro member of the organization) and a target date, or Keine with a
--   reason. One call writes the completion, the finding, the owner's client
--   follow-up (source: the visit job) and, for a Rückkehr, a return due item.
-- * A Rückkehr is a due item on the same plan revision, so on the same
--   equipment, due on the target date. It names the regular item it returns
--   to (`return_for_due_work_id`), never moves the regular next due date, and
--   completing it neither advances the plan nor generates a regular item.
--   Its target lies after the visit and before the regular next due date, so
--   it never takes a date the plan generates later.
-- * The previous entry public.complete_maintenance_due_work stays for the
--   previous release's code and reads through the new body as that code
--   expects: an unfinished visit without findings or a next action, so a
--   rollback keeps working. The new code calls only the new entry.

create type public.maintenance_next_action as enum (
  'return_visit', 'warranty_check', 'offer_replacement', 'none'
);

-- @destructive: after release 55088f06f04b: the deployed build never writes the new column, and the key accepts its null
alter table public.maintenance_due_work
  add column return_for_due_work_id uuid,
  add constraint maintenance_due_work_return_for_fkey
    foreign key (return_for_due_work_id, organization_id)
    references public.maintenance_due_work(id, organization_id) on delete no action;
create index maintenance_due_work_return_for_idx
  on public.maintenance_due_work (return_for_due_work_id, organization_id)
  where return_for_due_work_id is not null;

-- One row per partial or unresolved completion; append-only (no client role
-- reads it, and service_role may only select and insert).
create table public.maintenance_visit_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_due_work_id uuid not null,
  defects text[] not null,
  next_action public.maintenance_next_action not null,
  owner_user_id uuid references auth.users(id) on delete restrict,
  target_date date,
  note text,
  return_due_work_id uuid,
  client_follow_up_id uuid references public.client_follow_ups(id) on delete no action,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint maintenance_visit_findings_due_key unique (maintenance_due_work_id, organization_id),
  constraint maintenance_visit_findings_defects_count check (
    cardinality(defects) between 1 and 10 and array_position(defects, null) is null
  ),
  constraint maintenance_visit_findings_note_length check (
    note is null or length(btrim(note)) between 3 and 1000
  ),
  constraint maintenance_visit_findings_shape check (
    (next_action = 'none' and note is not null and owner_user_id is null and target_date is null
      and client_follow_up_id is null and return_due_work_id is null)
    or (next_action <> 'none' and note is null and owner_user_id is not null and target_date is not null
      and client_follow_up_id is not null
      and (next_action = 'return_visit') = (return_due_work_id is not null))
  ),
  foreign key (maintenance_due_work_id, organization_id)
    references public.maintenance_due_work(id, organization_id) on delete no action,
  foreign key (return_due_work_id, organization_id)
    references public.maintenance_due_work(id, organization_id) on delete no action
);
create index maintenance_visit_findings_organization_idx
  on public.maintenance_visit_findings (organization_id);
create index maintenance_visit_findings_owner_idx
  on public.maintenance_visit_findings (owner_user_id) where owner_user_id is not null;
create index maintenance_visit_findings_created_by_idx
  on public.maintenance_visit_findings (created_by);
create index maintenance_visit_findings_return_idx
  on public.maintenance_visit_findings (return_due_work_id, organization_id)
  where return_due_work_id is not null;
create index maintenance_visit_findings_follow_up_idx
  on public.maintenance_visit_findings (client_follow_up_id) where client_follow_up_id is not null;

alter table public.maintenance_visit_findings enable row level security;
revoke all on table public.maintenance_visit_findings from public, anon, authenticated, service_role;
grant select, insert on table public.maintenance_visit_findings to service_role;
create trigger maintenance_visit_findings_immutable before update or delete on public.maintenance_visit_findings
for each row execute function app_private.prevent_maintenance_history_mutation();

-- The completion body both entries share: evidence, the completed item, the
-- regular next item (actual-completion plans), and for an unfinished visit
-- its finding, the owner's follow-up and a Rückkehr. Runs under the caller's
-- manager check and operation lock.
create function app_private.complete_maintenance_due_work_with_next_action(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_scope_outcome public.maintenance_scope_outcome,
  p_completed_on date,
  p_work_artifact_revision_ids uuid[],
  p_reason text,
  p_defects text[],
  p_next_action public.maintenance_next_action,
  p_next_action_owner_id uuid,
  p_next_action_target_date date,
  p_next_action_note text,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_previous_entry boolean
)
returns public.maintenance_due_work
language plpgsql security invoker set search_path = ''
as $$
declare
  v_existing public.maintenance_due_work_events%rowtype;
  v_before public.maintenance_due_work%rowtype;
  v_after public.maintenance_due_work%rowtype;
  v_revision public.maintenance_plan_revisions%rowtype;
  v_plan public.maintenance_plans%rowtype;
  v_job_number text;
  v_defects text[];
  v_note text := nullif(btrim(coalesce(p_next_action_note, '')), '');
  v_unfinished boolean := p_scope_outcome in ('partial', 'unresolved');
  v_is_return boolean;
  v_regular_next_date date;
  v_next_due_date date;
  v_next_due_id uuid;
  v_return_id uuid;
  v_return_for_id uuid;
  v_follow_up_id uuid;
  v_due_at timestamptz;
  v_payload jsonb;
begin
  select coalesce(array_agg(btrim(defect) order by position), '{}') into v_defects
  from unnest(coalesce(p_defects, '{}')) with ordinality as item(defect, position)
  where nullif(btrim(defect), '') is not null;
  v_payload := jsonb_build_object(
    'scopeOutcome', p_scope_outcome,
    'completedOn', p_completed_on,
    'workArtifactRevisionIds', p_work_artifact_revision_ids,
    'defects', case when cardinality(v_defects) > 0 then to_jsonb(v_defects) end,
    'nextAction', p_next_action,
    'ownerUserId', p_next_action_owner_id,
    'targetDate', p_next_action_target_date,
    'note', v_note
  );
  if p_work_artifact_revision_ids is null
     or cardinality(p_work_artifact_revision_ids) not between 1 and 50
     or array_position(p_work_artifact_revision_ids, null) is not null then
    raise exception 'maintenance_due_evidence_required';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then raise exception 'maintenance_reason_required'; end if;
  if not v_unfinished or p_previous_entry then
    if p_next_action is not null or cardinality(v_defects) > 0 or p_next_action_owner_id is not null
       or p_next_action_target_date is not null or v_note is not null then
      raise exception 'maintenance_next_action_not_allowed';
    end if;
  else
    if p_next_action is null then raise exception 'maintenance_next_action_required'; end if;
    if cardinality(v_defects) not between 1 and 10
       or exists (select 1 from unnest(v_defects) defect where length(defect) not between 3 and 160) then
      raise exception 'maintenance_defect_required';
    end if;
    if p_next_action = 'none' then
      if p_next_action_owner_id is not null or p_next_action_target_date is not null then
        raise exception 'maintenance_next_action_not_allowed';
      end if;
      if v_note is null or length(v_note) not between 3 and 1000 then raise exception 'maintenance_reason_required'; end if;
    else
      if v_note is not null then raise exception 'maintenance_next_action_not_allowed'; end if;
      if p_next_action_owner_id is null then raise exception 'maintenance_next_action_owner_invalid'; end if;
      if p_next_action_target_date is null then raise exception 'maintenance_next_action_date_invalid'; end if;
    end if;
  end if;

  select * into v_existing from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id and event.request_operation = 'due_complete'
    and event.idempotency_key = p_idempotency_key;
  if found then
    -- Null keys are stripped, so a retry of the previous entry's request still matches.
    if v_existing.maintenance_due_work_id <> p_maintenance_due_work_id
       or jsonb_strip_nulls(v_existing.request_payload) <> jsonb_strip_nulls(v_payload) then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    select * into strict v_after from public.maintenance_due_work due_work
    where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id;
    return v_after;
  end if;
  -- After the replay: an owner who lost the manager role since keeps the recorded completion.
  if p_next_action_owner_id is not null
     and not app_private.maintenance_actor_is_manager(p_organization_id, p_next_action_owner_id) then
    raise exception 'maintenance_next_action_owner_invalid';
  end if;

  select * into v_before from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_due_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  if v_before.status <> 'visit_created' or v_before.job_id is null then raise exception 'maintenance_due_completion_not_allowed'; end if;
  if p_completed_on is null
     or p_completed_on < v_before.window_start_date
     or p_completed_on > (timezone('Europe/Berlin', now()))::date then
    raise exception 'maintenance_completion_date_invalid';
  end if;
  select * into strict v_revision from public.maintenance_plan_revisions revision
  where revision.id = v_before.maintenance_plan_revision_id and revision.organization_id = p_organization_id;
  v_is_return := v_before.return_for_due_work_id is not null;

  -- A Rückkehr keeps the plan's schedule: no next due date, no new regular item.
  if not v_is_return then
    if v_revision.next_due_basis = 'actual_completion_date' then
      v_next_due_date := app_private.add_months_clamped(p_completed_on, v_revision.interval_months);
    else
      v_next_due_date := app_private.add_months_clamped(v_before.original_due_date, v_revision.interval_months);
    end if;
    v_regular_next_date := v_next_due_date;
  else
    select due_work.next_due_date into v_regular_next_date from public.maintenance_due_work due_work
    where due_work.id = v_before.return_for_due_work_id and due_work.organization_id = p_organization_id;
  end if;
  if p_next_action is not null and p_next_action <> 'none' and (
    p_next_action_target_date <= p_completed_on
    or (p_next_action = 'return_visit' and p_next_action_target_date >= v_regular_next_date)
  ) then
    raise exception 'maintenance_next_action_date_invalid';
  end if;

  perform set_config('app.maintenance_write', 'true', true);
  insert into public.maintenance_due_evidence_links (
    organization_id, maintenance_due_work_id, work_artifact_revision_id, created_by
  )
  select distinct
    p_organization_id, p_maintenance_due_work_id, evidence.revision_id, p_actor_id
  from unnest(p_work_artifact_revision_ids) as evidence(revision_id)
  on conflict (maintenance_due_work_id, work_artifact_revision_id) do nothing;
  update public.maintenance_due_work due_work set status = 'completed',
    scope_outcome = p_scope_outcome, completed_on = p_completed_on,
    next_due_date = v_next_due_date, exception_reason = null,
    version = due_work.version + 1, updated_by = p_actor_id, updated_at = now()
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id
  returning * into v_after;

  if not v_is_return and v_revision.next_due_basis = 'actual_completion_date' then
    v_next_due_id := gen_random_uuid();
    insert into public.maintenance_due_work (
      id, organization_id, maintenance_plan_id, maintenance_plan_revision_id,
      original_due_date, due_date, window_start_date, window_end_date,
      created_by, updated_by
    ) values (
      v_next_due_id, p_organization_id, v_before.maintenance_plan_id, v_revision.id,
      v_next_due_date, v_next_due_date,
      v_next_due_date - v_revision.due_window_before_days,
      v_next_due_date + v_revision.due_window_after_days,
      p_actor_id, p_actor_id
    ) on conflict (maintenance_plan_id, maintenance_plan_revision_id, original_due_date)
      do nothing returning id into v_next_due_id;
    -- A Rückkehr on that date would hide the regular obligation.
    if v_next_due_id is null and exists (
      select 1 from public.maintenance_due_work due_work
      where due_work.organization_id = p_organization_id
        and due_work.maintenance_plan_id = v_before.maintenance_plan_id
        and due_work.maintenance_plan_revision_id = v_revision.id
        and due_work.original_due_date = v_next_due_date
        and due_work.return_for_due_work_id is not null
    ) then
      raise exception 'maintenance_return_date_taken';
    end if;
    if v_next_due_id is not null then
      perform app_private.record_maintenance_due_event(
        p_organization_id, v_next_due_id, 'generated', p_actor_id, null,
        'due_generated', v_next_due_id, jsonb_build_object('dueDate', v_next_due_date),
        null, app_private.maintenance_due_snapshot(v_next_due_id, p_organization_id)
      );
    end if;
  end if;

  if p_next_action = 'return_visit' then
    -- A return from a return item still returns to the regular item, in row and history alike.
    v_return_for_id := coalesce(v_before.return_for_due_work_id, v_before.id);
    v_return_id := gen_random_uuid();
    insert into public.maintenance_due_work (
      id, organization_id, maintenance_plan_id, maintenance_plan_revision_id,
      original_due_date, due_date, window_start_date, window_end_date,
      return_for_due_work_id, created_by, updated_by
    ) values (
      v_return_id, p_organization_id, v_before.maintenance_plan_id, v_revision.id,
      p_next_action_target_date, p_next_action_target_date,
      p_completed_on, p_next_action_target_date + v_revision.due_window_after_days,
      v_return_for_id, p_actor_id, p_actor_id
    ) on conflict (maintenance_plan_id, maintenance_plan_revision_id, original_due_date)
      do nothing returning id into v_return_id;
    if v_return_id is null then raise exception 'maintenance_return_date_taken'; end if;
    perform app_private.record_maintenance_due_event(
      p_organization_id, v_return_id, 'generated', p_actor_id, null,
      'due_return_opened', v_return_id,
      jsonb_build_object('dueDate', p_next_action_target_date, 'returnForDueWorkId', v_return_for_id),
      null, app_private.maintenance_due_snapshot(v_return_id, p_organization_id)
    );
  end if;
  perform set_config('app.maintenance_write', 'false', true);

  if p_next_action is not null and p_next_action <> 'none' then
    select * into strict v_plan from public.maintenance_plans plan
    where plan.id = v_before.maintenance_plan_id and plan.organization_id = p_organization_id;
    select job.job_number into strict v_job_number from public.jobs job
    where job.id = v_before.job_id and job.organization_id = p_organization_id;
    v_due_at := (p_next_action_target_date + time '08:00') at time zone 'Europe/Berlin';
    insert into public.client_follow_ups (
      organization_id, client_id, source_type, source_id, title, note,
      owner_user_id, due_at, created_by, updated_by
    ) values (
      p_organization_id, v_plan.client_id, 'job', v_before.job_id,
      case p_next_action
        when 'return_visit' then 'Rückkehr einplanen'
        when 'warranty_check' then 'Garantie prüfen'
        else 'Austausch anbieten'
      end || ' · ' || v_plan.plan_number || ' · ' || coalesce(v_job_number, 'Wartungsbesuch'),
      'Offene Mängel: ' || array_to_string(v_defects, '; '),
      p_next_action_owner_id, v_due_at, p_actor_id, p_actor_id
    ) returning id into v_follow_up_id;
    insert into public.client_follow_up_events (
      organization_id, client_id, follow_up_id, event_type, event_payload, actor_id
    ) values (
      p_organization_id, v_plan.client_id, v_follow_up_id, 'created',
      jsonb_build_object('ownerUserId', p_next_action_owner_id, 'dueAt', v_due_at,
        'sourceType', 'job', 'sourceId', v_before.job_id),
      p_actor_id
    );
  end if;
  if v_unfinished and not p_previous_entry then
    insert into public.maintenance_visit_findings (
      organization_id, maintenance_due_work_id, defects, next_action, owner_user_id,
      target_date, note, return_due_work_id, client_follow_up_id, created_by
    ) values (
      p_organization_id, v_before.id, v_defects, p_next_action, p_next_action_owner_id,
      p_next_action_target_date, v_note, v_return_id, v_follow_up_id, p_actor_id
    );
  end if;

  perform app_private.record_maintenance_due_event(
    p_organization_id, p_maintenance_due_work_id, 'completed', p_actor_id, p_reason,
    'due_complete', p_idempotency_key, v_payload, to_jsonb(v_before),
    app_private.maintenance_due_snapshot(p_maintenance_due_work_id, p_organization_id)
  );
  return v_after;
end;
$$;

-- „Wartung abschließen“ with the next action of an unfinished visit.
create function public.complete_maintenance_visit(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_scope_outcome public.maintenance_scope_outcome,
  p_completed_on date,
  p_work_artifact_revision_ids uuid[],
  p_reason text,
  p_defects text[],
  p_next_action public.maintenance_next_action,
  p_next_action_owner_id uuid,
  p_next_action_target_date date,
  p_next_action_note text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'due_complete', p_idempotency_key);
  return app_private.complete_maintenance_due_work_with_next_action(
    p_organization_id, p_maintenance_due_work_id, p_expected_version, p_scope_outcome,
    p_completed_on, p_work_artifact_revision_ids, p_reason, p_defects, p_next_action,
    p_next_action_owner_id, p_next_action_target_date, p_next_action_note, p_actor_id, p_idempotency_key,
    false
  );
end;
$$;

-- The previous release's entry: the same body as that code expects, an
-- unfinished visit without findings or a next action. Dropped after the next
-- production release (lib/security/retired-functions.test.ts).
create or replace function public.complete_maintenance_due_work(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_scope_outcome public.maintenance_scope_outcome,
  p_completed_on date,
  p_work_artifact_revision_ids uuid[],
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'due_complete', p_idempotency_key);
  return app_private.complete_maintenance_due_work_with_next_action(
    p_organization_id, p_maintenance_due_work_id, p_expected_version, p_scope_outcome,
    p_completed_on, p_work_artifact_revision_ids, p_reason, null, null, null, null, null,
    p_actor_id, p_idempotency_key, true
  );
end;
$$;

-- The body is a step of the two entries only: no role executes it
-- (docs/technical/security.md, "Add a privileged function", condition a).
revoke all on function app_private.complete_maintenance_due_work_with_next_action(
  uuid, uuid, bigint, public.maintenance_scope_outcome, date, uuid[], text, text[],
  public.maintenance_next_action, uuid, date, text, uuid, uuid, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.complete_maintenance_visit(
  uuid, uuid, bigint, public.maintenance_scope_outcome, date, uuid[], text, text[],
  public.maintenance_next_action, uuid, date, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.complete_maintenance_visit(
  uuid, uuid, bigint, public.maintenance_scope_outcome, date, uuid[], text, text[],
  public.maintenance_next_action, uuid, date, text, uuid, uuid
) to service_role;
