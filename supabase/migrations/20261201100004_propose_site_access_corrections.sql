-- A field worker proposes a corrected access contact for office review
-- (werk-flow/werkflow-planning#329).
--
-- 1. site_access_proposals: what an assigned field worker proposes for the
--    Einsatzort of their job: an access contact (name, phone, note) and
--    access notes. A proposal never changes the Einsatzort by itself. One
--    proposal per job is open at a time; a second one from the job's team
--    replaces its values and proposer.
-- 2. A manager accepts it, which writes the contact and the access notes in
--    the same call: it corrects the chosen Zugangskontakt of the Einsatzort
--    (20261130090001's history names the manager) or adds a new one. Or the
--    manager rejects it with a reason.
-- 3. A decided proposal keeps its decision, reason, proposer, decider and
--    times, but not the proposed name, phone, note and access notes: an
--    accepted value lives on in the Einsatzort and its contact, a rejected
--    one is a third person's contact data the office chose not to keep.
--
-- Division of work: lib/site-access-proposals/actions.ts establishes
-- identity, organization and role, and for a proposal that the caller is
-- assigned to the job. The functions check the same under lock and write.
--
-- 4. One read returns the open requests and the open proposals for a
--    manager's attention derivation.
--
-- Expand-only: the previous release reads and writes none of the new objects;
-- the attention source-type checks keep every earlier value, and
-- list_open_request_attention stays.
--
-- Prevention: Tier 1 (constraints, the decision guard and the functions'
-- checks), Tier 2 supabase/tests/site_access_proposals.sql and
-- lib/site-access-proposals/action-boundaries.test.ts.

create table public.site_access_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null,
  site_id uuid not null,
  -- The customer the Einsatzort is filed under (client_sites.client_id).
  client_id uuid not null,
  -- Null once the account is deleted: the proposal stays, the person does not.
  proposed_by uuid references auth.users (id) on delete set null,
  proposed_at timestamptz not null default now(),
  -- Raised by every replacement of the open proposal; a decision names the
  -- revision its manager reviewed.
  revision integer not null default 1,
  contact_name text,
  contact_phone text,
  contact_note text,
  access_notes text,
  status text not null default 'open',
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  rejection_reason text,
  -- What an acceptance changed: the contact it wrote, and whether it wrote
  -- the access notes.
  applied_contact_id uuid references public.client_contacts (id) on delete set null,
  applied_access_notes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_access_proposals_job_fk foreign key (job_id, organization_id)
    references public.jobs (id, organization_id) on delete cascade,
  constraint site_access_proposals_site_fk foreign key (site_id, client_id, organization_id)
    references public.client_sites (id, client_id, organization_id) on delete cascade,
  constraint site_access_proposals_status_check check (status in ('open', 'accepted', 'rejected')),
  constraint site_access_proposals_revision_check check (revision >= 1),
  constraint site_access_proposals_text_check check (
    (contact_name is null or (contact_name = btrim(contact_name) and length(contact_name) between 1 and 200))
    and (contact_phone is null or (contact_phone = btrim(contact_phone) and length(contact_phone) between 1 and 50))
    and (contact_note is null or (contact_note = btrim(contact_note) and length(contact_note) between 1 and 500))
    and (access_notes is null or (access_notes = btrim(access_notes) and length(access_notes) between 1 and 2000))
  ),
  constraint site_access_proposals_state_check check (
    case status
      when 'open' then decided_at is null and decided_by is null and rejection_reason is null
        and applied_contact_id is null and not applied_access_notes
        and (contact_name is not null or access_notes is not null)
        and (contact_name is not null or (contact_phone is null and contact_note is null))
      when 'accepted' then decided_at is not null and rejection_reason is null
        and contact_name is null and contact_phone is null and contact_note is null and access_notes is null
      else decided_at is not null and applied_contact_id is null and not applied_access_notes
        and rejection_reason = btrim(rejection_reason) and length(rejection_reason) between 3 and 500
        and contact_name is null and contact_phone is null and contact_note is null and access_notes is null
    end
  )
);

create unique index site_access_proposals_replident_idx on public.site_access_proposals (id, organization_id);
-- One open proposal per job.
create unique index site_access_proposals_open_job_idx on public.site_access_proposals (job_id)
  where status = 'open';
create index site_access_proposals_open_org_idx on public.site_access_proposals (organization_id, proposed_at)
  where status = 'open';
create index site_access_proposals_job_idx on public.site_access_proposals (job_id, proposed_at desc, id desc);
create index site_access_proposals_job_fk_idx on public.site_access_proposals (job_id, organization_id);
create index site_access_proposals_site_fk_idx on public.site_access_proposals (site_id, client_id, organization_id);
create index site_access_proposals_proposed_by_fk_idx on public.site_access_proposals (proposed_by);
create index site_access_proposals_decided_by_fk_idx on public.site_access_proposals (decided_by);
create index site_access_proposals_applied_contact_fk_idx on public.site_access_proposals (applied_contact_id);

-- A session reads only the columns that signal a change: a manager in the
-- organization, a field worker on the job. The server reads the rest.
alter table public.site_access_proposals enable row level security;
create policy "Managers and the job's team can view site access proposals" on public.site_access_proposals
  for select to authenticated
  using (
    organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
    or job_id in (select app_private.get_user_assigned_job_ids((select auth.uid())))
  );
revoke all on table public.site_access_proposals from public, anon, authenticated, service_role;
grant select (id, organization_id, job_id, status, updated_at) on table public.site_access_proposals to authenticated;
grant select, insert, update on table public.site_access_proposals to service_role;

create trigger site_access_proposals_updated_at before update on public.site_access_proposals
  for each row execute function update_updated_at_column();

alter table public.site_access_proposals replica identity using index site_access_proposals_replident_idx;
alter publication supabase_realtime add table public.site_access_proposals;
create trigger emit_realtime_deletion after delete on public.site_access_proposals
  for each row execute function app_private.emit_realtime_deletion();

-- A decision is history: only an open proposal changes. A deleted account
-- clears its actor.
create function app_private.guard_site_access_proposal_decision()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.job_id is distinct from old.job_id
    or new.created_at is distinct from old.created_at
    or (old.status <> 'open' and (
      new.status is distinct from old.status
      or new.site_id is distinct from old.site_id
      or new.client_id is distinct from old.client_id
      or new.proposed_at is distinct from old.proposed_at
      or new.revision is distinct from old.revision
      or new.decided_at is distinct from old.decided_at
      or new.rejection_reason is distinct from old.rejection_reason
      or new.applied_access_notes is distinct from old.applied_access_notes
      or (new.proposed_by is distinct from old.proposed_by and new.proposed_by is not null)
      or (new.decided_by is distinct from old.decided_by and new.decided_by is not null)
      or (new.applied_contact_id is distinct from old.applied_contact_id and new.applied_contact_id is not null)
    ))
  then
    raise exception 'site_access_proposal_decided';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_site_access_proposal_decision() from public, anon, authenticated;

create trigger guard_site_access_proposal_decision before update on public.site_access_proposals
  for each row execute function app_private.guard_site_access_proposal_decision();

-- Records what the caller proposes for the Einsatzort of a job they are
-- assigned to, or replaces the values of the job's open proposal. Blank text
-- counts as missing. Refusals: invalid_input, job_not_found, site_not_on_job,
-- not_authorized.
create function public.propose_site_access(
  p_actor_id uuid,
  p_organization_id uuid,
  p_job_id uuid,
  p_site_id uuid,
  p_contact_name text,
  p_contact_phone text,
  p_contact_note text,
  p_access_notes text
)
returns public.site_access_proposals
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_name text := nullif(btrim(p_contact_name), '');
  v_phone text := nullif(btrim(p_contact_phone), '');
  v_note text := nullif(btrim(p_contact_note), '');
  v_access_notes text := nullif(btrim(p_access_notes), '');
  v_job_site_id uuid;
  v_client_id uuid;
  v_proposal public.site_access_proposals;
begin
  if p_actor_id is null or p_organization_id is null or p_job_id is null or p_site_id is null
    or (v_name is null and v_access_notes is null)
    or (v_name is null and (v_phone is not null or v_note is not null))
    or length(v_name) > 200 or length(v_phone) > 50 or length(v_note) > 500 or length(v_access_notes) > 2000
  then
    raise exception 'invalid_input';
  end if;
  select job.site_id into v_job_site_id from public.jobs job
  where job.id = p_job_id and job.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'job_not_found';
  end if;
  if v_job_site_id is distinct from p_site_id then
    raise exception 'site_not_on_job';
  end if;
  -- A share lock holds the assignment until commit: its removal waits for
  -- this call or makes it refuse.
  perform 1 from public.job_assignments assignment
  where assignment.organization_id = p_organization_id
    and assignment.job_id = p_job_id
    and assignment.user_id = p_actor_id
  for share;
  if not found or not app_private.p1_24_has_effective_access(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select site.client_id into v_client_id from public.client_sites site
  where site.id = p_site_id and site.organization_id = p_organization_id;

  insert into public.site_access_proposals (
    organization_id, job_id, site_id, client_id, proposed_by,
    contact_name, contact_phone, contact_note, access_notes
  ) values (
    p_organization_id, p_job_id, p_site_id, v_client_id, p_actor_id,
    v_name, v_phone, v_note, v_access_notes
  )
  on conflict (job_id) where status = 'open' do update set
    site_id = excluded.site_id,
    client_id = excluded.client_id,
    proposed_by = excluded.proposed_by,
    proposed_at = now(),
    revision = site_access_proposals.revision + 1,
    contact_name = excluded.contact_name,
    contact_phone = excluded.contact_phone,
    contact_note = excluded.contact_note,
    access_notes = excluded.access_notes
  returning * into v_proposal;
  return v_proposal;
end;
$$;
revoke all on function public.propose_site_access(uuid, uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.propose_site_access(uuid, uuid, uuid, uuid, text, text, text, text)
  to service_role;

-- Locks an open proposal of the organization in the revision its manager
-- reviewed, and the actor's manager membership, and names the actor for the
-- master-data history. Refusals as lock_client_for_master_write, and
-- proposal_not_found, proposal_already_decided and proposal_changed (a
-- worker replaced it since the review read it).
create function app_private.lock_open_site_access_proposal(
  p_actor_id uuid,
  p_organization_id uuid,
  p_proposal_id uuid,
  p_revision integer
)
returns public.site_access_proposals
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_proposal public.site_access_proposals;
begin
  if p_actor_id is null or p_organization_id is null or p_proposal_id is null or p_revision is null then
    raise exception 'invalid_input';
  end if;
  select * into v_proposal from public.site_access_proposals proposal
  where proposal.id = p_proposal_id and proposal.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'proposal_not_found';
  end if;
  perform app_private.lock_client_for_master_write(p_actor_id, p_organization_id, v_proposal.client_id);
  if v_proposal.status <> 'open' then
    raise exception 'proposal_already_decided';
  end if;
  if v_proposal.revision <> p_revision then
    raise exception 'proposal_changed';
  end if;
  return v_proposal;
end;
$$;
revoke all on function app_private.lock_open_site_access_proposal(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function app_private.lock_open_site_access_proposal(uuid, uuid, uuid, integer) to service_role;

-- Applies an open proposal to its Einsatzort. A proposed contact corrects
-- p_contact_id, an active Zugangskontakt of that Einsatzort, or with null
-- becomes a new one; its note replaces the contact's note only when given.
-- Proposed access notes replace the Einsatzort's. The call names what the
-- review showed of what it overwrites: the Einsatzort's access notes, and the
-- corrected contact's name and phone, an empty text for none. Another
-- decision on the same Einsatzort since then refuses it with site_changed, so
-- it never overwrites a change its manager has not seen. Refusals as
-- lock_open_site_access_proposal, and invalid_input (a contact to correct
-- without a proposed contact), contact_not_found and site_changed.
create function public.accept_site_access_proposal(
  p_actor_id uuid,
  p_organization_id uuid,
  p_proposal_id uuid,
  p_revision integer,
  p_reviewed_access_notes text,
  p_contact_id uuid default null,
  p_reviewed_contact_name text default null,
  p_reviewed_contact_phone text default null
)
returns public.site_access_proposals
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_proposal public.site_access_proposals;
  v_contact public.client_contacts;
  v_access_notes text;
  v_contact_id uuid;
begin
  v_proposal := app_private.lock_open_site_access_proposal(p_actor_id, p_organization_id, p_proposal_id, p_revision);
  if v_proposal.contact_name is null and p_contact_id is not null then
    raise exception 'invalid_input';
  end if;

  -- What the review showed must still hold, under the row locks, before any write.
  if v_proposal.access_notes is not null then
    select site.access_notes into v_access_notes from public.client_sites site
    where site.id = v_proposal.site_id and site.organization_id = p_organization_id
    for update;
    if coalesce(v_access_notes, '') <> coalesce(p_reviewed_access_notes, '') then
      raise exception 'site_changed';
    end if;
  end if;
  if v_proposal.contact_name is not null and p_contact_id is not null then
    select * into v_contact from public.client_contacts contact
    where contact.id = p_contact_id and contact.organization_id = p_organization_id
      and contact.client_id = v_proposal.client_id and contact.site_id = v_proposal.site_id
      and contact.site_role = 'zugangskontakt' and contact.is_active
    for update;
    if not found then
      raise exception 'contact_not_found';
    end if;
    if v_contact.name is distinct from p_reviewed_contact_name
      or coalesce(v_contact.phone, '') <> coalesce(p_reviewed_contact_phone, '') then
      raise exception 'site_changed';
    end if;
  end if;

  if v_contact.id is not null then
    update public.client_contacts contact set
      name = v_proposal.contact_name,
      phone = v_proposal.contact_phone,
      notes = coalesce(v_proposal.contact_note, contact.notes)
    where contact.id = v_contact.id
    returning contact.id into v_contact_id;
  elsif v_proposal.contact_name is not null then
    insert into public.client_contacts (
      organization_id, client_id, name, phone, notes, site_id, site_role, created_by
    ) values (
      p_organization_id, v_proposal.client_id, v_proposal.contact_name, v_proposal.contact_phone,
      v_proposal.contact_note, v_proposal.site_id, 'zugangskontakt', p_actor_id
    )
    returning id into v_contact_id;
  end if;

  if v_proposal.access_notes is not null then
    update public.client_sites site set access_notes = v_proposal.access_notes
    where site.id = v_proposal.site_id and site.organization_id = p_organization_id;
  end if;

  update public.site_access_proposals proposal set
    status = 'accepted',
    decided_by = p_actor_id,
    decided_at = now(),
    applied_contact_id = v_contact_id,
    applied_access_notes = v_proposal.access_notes is not null,
    contact_name = null,
    contact_phone = null,
    contact_note = null,
    access_notes = null
  where proposal.id = v_proposal.id
  returning * into v_proposal;
  return v_proposal;
end;
$$;
revoke all on function public.accept_site_access_proposal(uuid, uuid, uuid, integer, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.accept_site_access_proposal(uuid, uuid, uuid, integer, text, uuid, text, text) to service_role;

-- Rejects an open proposal with a reason of 3 to 500 characters and clears
-- the proposed values in the same statement. Refusals as
-- lock_open_site_access_proposal, and invalid_input.
create function public.reject_site_access_proposal(
  p_actor_id uuid,
  p_organization_id uuid,
  p_proposal_id uuid,
  p_revision integer,
  p_reason text
)
returns public.site_access_proposals
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_reason text := btrim(p_reason);
  v_proposal public.site_access_proposals;
begin
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'invalid_input';
  end if;
  v_proposal := app_private.lock_open_site_access_proposal(p_actor_id, p_organization_id, p_proposal_id, p_revision);
  update public.site_access_proposals proposal set
    status = 'rejected',
    decided_by = p_actor_id,
    decided_at = now(),
    rejection_reason = v_reason,
    contact_name = null,
    contact_phone = null,
    contact_note = null,
    access_notes = null
  where proposal.id = v_proposal.id
  returning * into v_proposal;
  return v_proposal;
end;
$$;
revoke all on function public.reject_site_access_proposal(uuid, uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.reject_site_access_proposal(uuid, uuid, uuid, integer, text) to service_role;

-- One read of the pending office sets a manager's attention derivation
-- needs, so the new task kind adds no backend request: the open requests as
-- list_open_request_attention (20261129100001) returns them, and the open
-- access proposals without their proposed values (the review reads those). Each array holds at most p_limit + 1 rows, so the caller
-- sees an overflow instead of a cut. list_open_request_attention stays for
-- the previous build; a later release drops it
-- (KEPT_FOR_DEPLOYED_BUILD in lib/security/retired-functions.test.ts).
create function public.read_manager_attention_sets(p_organization_id uuid, p_limit integer)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(to_jsonb(open_request) order by open_request.received_at, open_request.id)
      from (
        select
          request.id, request.request_number, request.summary, request.status, request.urgency,
          request.assigned_to, request.received_at, request.callback_due_at,
          coalesce(request.callback_due_at < now(), false) as callback_overdue,
          exists (
            select 1 from public.organization_members member
            where member.organization_id = p_organization_id
              and member.user_id = request.assigned_to
              and member.role in ('admin', 'buero')
              -- A suspended or ended manager keeps the membership row but cannot act.
              and app_private.p1_24_has_effective_access(member.organization_id, member.user_id)
          ) as owner_is_manager
        from public.client_requests request
        where request.organization_id = p_organization_id
          and request.status in ('offen', 'in_klaerung')
        order by request.received_at, request.id
        limit p_limit + 1
      ) open_request
    ), '[]'::jsonb),
    'access_proposals', coalesce((
      select jsonb_agg(to_jsonb(open_proposal) order by open_proposal.proposed_at, open_proposal.id)
      from (
        select
          proposal.id, proposal.job_id, proposal.site_id, proposal.proposed_by, proposal.proposed_at
        from public.site_access_proposals proposal
        where proposal.organization_id = p_organization_id
          and proposal.status = 'open'
        order by proposal.proposed_at, proposal.id
        limit p_limit + 1
      ) open_proposal
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.read_manager_attention_sets(uuid, integer) from public, anon, authenticated;
grant execute on function public.read_manager_attention_sets(uuid, integer) to service_role;

-- The attention identity union in lib/attention/types.ts and these checks stay
-- in step: an open access proposal waiting for a manager
-- (site_access_proposal). Expand-only: every earlier value stays allowed.
-- not valid: every existing row holds an earlier value, so no table scan runs
-- under the lock; new writes are checked as before.
-- @destructive: after release acce7e96: the constraint returns below with every earlier source type and one new one
alter table public.attention_read_states
  drop constraint attention_read_states_source_type_check;
-- @destructive: after release acce7e96: that build writes only source types this list keeps
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review',
      'organization_join_request', 'planning_visit_replan',
      'client_request_callback_overdue', 'site_access_proposal'
    ])
  ) not valid;
-- @destructive: after release acce7e96: the constraint returns below with every earlier source type and one new one
alter table public.attention_events
  drop constraint attention_events_source_type_check;
-- @destructive: after release acce7e96: that build writes only source types this list keeps
alter table public.attention_events
  add constraint attention_events_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review',
      'organization_join_request', 'planning_visit_replan',
      'client_request_callback_overdue', 'site_access_proposal'
    ])
  ) not valid;
