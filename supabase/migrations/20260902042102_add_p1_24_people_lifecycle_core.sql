-- P1-24: controlled people lifecycle. This migration is additive and inserts
-- no organization data, lifecycle, template, plan, requirement, document
-- classification, release, acknowledgement, suspension, or exit.

create type public.personnel_access_state as enum (
  'not_configured', 'scheduled', 'active', 'suspended', 'ended'
);
create type public.personnel_access_transition_kind as enum (
  'schedule_activation', 'activate_now', 'suspend_now',
  'schedule_suspension', 'cancel_scheduled', 'reactivate', 'end_access'
);
create type public.personnel_employment_state as enum (
  'planned', 'active', 'notice', 'inactive', 'exited'
);
create type public.personnel_employment_transition_kind as enum (
  'plan_start', 'start', 'record_notice', 'plan_exit', 'mark_inactive',
  'exit', 'cancel_scheduled', 'reverse', 'reactivate'
);
create type public.personnel_document_access_class as enum (
  'personnel_standard', 'admin_restricted', 'health_evidence'
);
create type public.personnel_document_evidence_state as enum (
  'pending', 'valid', 'expiring', 'superseded'
);
create type public.personnel_template_state as enum (
  'draft', 'published', 'archived'
);
create type public.personnel_requirement_type as enum (
  'document', 'qualification', 'employment_condition', 'work_schedule',
  'team', 'access', 'acknowledgement', 'manual'
);
create type public.personnel_requirement_state as enum (
  'missing', 'pending', 'fulfilled', 'blocked', 'waived', 'cancelled'
);
create type public.personnel_onboarding_plan_state as enum (
  'in_progress', 'blocked', 'ready', 'cancelled'
);
create type public.personnel_acknowledgement_kind as enum (
  'document_received', 'requirement_completed'
);

create table public.personnel_access_lifecycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  state public.personnel_access_state not null,
  state_effective_at timestamptz not null,
  scheduled_state public.personnel_access_state,
  scheduled_for timestamptz,
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personnel_access_lifecycles_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_access_lifecycles_employee_unique unique (employee_record_id),
  constraint personnel_access_lifecycles_id_org_unique unique (id, organization_id),
  constraint personnel_access_lifecycles_schedule_shape check (
    (scheduled_state is null and scheduled_for is null)
    or (
      scheduled_state is not null
      and scheduled_for is not null
      and scheduled_state in ('active', 'suspended', 'ended')
    )
  ),
  constraint personnel_access_lifecycles_scheduled_state_shape check (
    state <> 'scheduled' or scheduled_state = 'active'
  )
);
create index personnel_access_lifecycles_org_state_idx
  on public.personnel_access_lifecycles(organization_id, state, scheduled_for);

create table public.personnel_access_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  access_lifecycle_id uuid not null,
  employee_record_id uuid not null,
  transition_kind public.personnel_access_transition_kind not null,
  from_state public.personnel_access_state not null,
  to_state public.personnel_access_state not null,
  effective_at timestamptz not null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  lifecycle_version bigint not null check (lifecycle_version > 0),
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint personnel_access_transitions_lifecycle_org_fkey
    foreign key (access_lifecycle_id, organization_id)
    references public.personnel_access_lifecycles(id, organization_id) on delete cascade,
  constraint personnel_access_transitions_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_access_transitions_operation_unique unique (organization_id, operation_id),
  constraint personnel_access_transitions_lifecycle_version_unique
    unique (access_lifecycle_id, lifecycle_version),
  constraint personnel_access_transitions_cancel_shape check (
    (cancelled_at is null and cancelled_by is null)
    or (cancelled_at is not null and cancelled_by is not null)
  )
);
create index personnel_access_transitions_employee_idx
  on public.personnel_access_transitions(employee_record_id, effective_at desc, created_at desc);

create table public.personnel_employment_lifecycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  state public.personnel_employment_state not null,
  state_effective_on date not null,
  scheduled_state public.personnel_employment_state,
  scheduled_for date,
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personnel_employment_lifecycles_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_employment_lifecycles_employee_unique unique (employee_record_id),
  constraint personnel_employment_lifecycles_id_org_unique unique (id, organization_id),
  constraint personnel_employment_lifecycles_schedule_shape check (
    (scheduled_state is null and scheduled_for is null)
    or (scheduled_state is not null and scheduled_for is not null)
  )
);
create index personnel_employment_lifecycles_org_state_idx
  on public.personnel_employment_lifecycles(organization_id, state, scheduled_for);

create table public.personnel_employment_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employment_lifecycle_id uuid not null,
  employee_record_id uuid not null,
  transition_kind public.personnel_employment_transition_kind not null,
  from_state public.personnel_employment_state not null,
  to_state public.personnel_employment_state not null,
  effective_on date not null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  lifecycle_version bigint not null check (lifecycle_version > 0),
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  unresolved_work jsonb not null default '[]'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint personnel_employment_transitions_lifecycle_org_fkey
    foreign key (employment_lifecycle_id, organization_id)
    references public.personnel_employment_lifecycles(id, organization_id) on delete cascade,
  constraint personnel_employment_transitions_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_employment_transitions_operation_unique unique (organization_id, operation_id),
  constraint personnel_employment_transitions_lifecycle_version_unique
    unique (employment_lifecycle_id, lifecycle_version),
  constraint personnel_employment_transitions_work_shape check (jsonb_typeof(unresolved_work) = 'array'),
  constraint personnel_employment_transitions_cancel_shape check (
    (cancelled_at is null and cancelled_by is null)
    or (cancelled_at is not null and cancelled_by is not null)
  )
);
create index personnel_employment_transitions_employee_idx
  on public.personnel_employment_transitions(employee_record_id, effective_on desc, created_at desc);

create table public.personnel_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  document_id uuid not null,
  document_type text not null check (nullif(btrim(document_type), '') is not null),
  access_class public.personnel_document_access_class not null,
  evidence_state public.personnel_document_evidence_state not null default 'pending',
  valid_until date,
  version bigint not null default 1 check (version > 0),
  classified_by uuid references auth.users(id) on delete set null,
  classified_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint personnel_documents_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_documents_document_org_fkey
    foreign key (document_id, organization_id)
    references public.documents(id, organization_id) on delete restrict,
  constraint personnel_documents_document_unique unique (document_id),
  constraint personnel_documents_id_org_unique unique (id, organization_id)
);
create index personnel_documents_employee_state_idx
  on public.personnel_documents(employee_record_id, evidence_state, valid_until);

create table public.personnel_document_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  personnel_document_id uuid not null,
  employee_record_id uuid not null,
  document_version_number integer not null check (document_version_number > 0),
  released_by uuid references auth.users(id) on delete set null,
  released_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint personnel_document_releases_document_org_fkey
    foreign key (personnel_document_id, organization_id)
    references public.personnel_documents(id, organization_id) on delete cascade,
  constraint personnel_document_releases_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_document_releases_version_unique
    unique (personnel_document_id, document_version_number),
  constraint personnel_document_releases_operation_unique unique (organization_id, operation_id),
  constraint personnel_document_releases_revoke_shape check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (
      revoked_at is not null
      and revoked_by is not null
      and nullif(btrim(revoke_reason), '') is not null
    )
  )
);
create index personnel_document_releases_employee_idx
  on public.personnel_document_releases(employee_record_id, released_at desc);

create table public.personnel_onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (nullif(btrim(name), '') is not null),
  description text,
  state public.personnel_template_state not null default 'draft',
  current_version_number integer not null default 1 check (current_version_number > 0),
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personnel_onboarding_templates_id_org_unique unique (id, organization_id)
);
create unique index personnel_onboarding_templates_name_unique
  on public.personnel_onboarding_templates(organization_id, lower(btrim(name)))
  where state <> 'archived';

create table public.personnel_onboarding_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null,
  version_number integer not null check (version_number > 0),
  name text not null check (nullif(btrim(name), '') is not null),
  description text,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint personnel_onboarding_template_versions_template_org_fkey
    foreign key (template_id, organization_id)
    references public.personnel_onboarding_templates(id, organization_id) on delete cascade,
  constraint personnel_onboarding_template_versions_unique unique (template_id, version_number),
  constraint personnel_onboarding_template_versions_operation_unique unique (organization_id, operation_id),
  constraint personnel_onboarding_template_versions_id_org_unique unique (id, organization_id)
);

create table public.personnel_onboarding_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_version_id uuid not null,
  requirement_type public.personnel_requirement_type not null,
  title text not null check (nullif(btrim(title), '') is not null),
  description text,
  is_required boolean not null default true,
  blocks_access boolean not null default false,
  due_offset_days integer check (due_offset_days is null or due_offset_days between -365 and 3650),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint personnel_onboarding_template_items_version_org_fkey
    foreign key (template_version_id, organization_id)
    references public.personnel_onboarding_template_versions(id, organization_id) on delete cascade,
  constraint personnel_onboarding_template_items_order_unique
    unique (template_version_id, sort_order)
);

create table public.personnel_onboarding_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  template_version_id uuid,
  name text not null check (nullif(btrim(name), '') is not null),
  state public.personnel_onboarding_plan_state not null default 'in_progress',
  target_start_date date,
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personnel_onboarding_plans_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_onboarding_plans_template_org_fkey
    foreign key (template_version_id, organization_id)
    references public.personnel_onboarding_template_versions(id, organization_id) on delete restrict,
  constraint personnel_onboarding_plans_id_org_unique unique (id, organization_id)
);
create index personnel_onboarding_plans_employee_idx
  on public.personnel_onboarding_plans(employee_record_id, created_at desc);

create table public.personnel_onboarding_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,
  employee_record_id uuid not null,
  source_template_item_id uuid references public.personnel_onboarding_template_items(id) on delete set null,
  requirement_type public.personnel_requirement_type not null,
  title text not null check (nullif(btrim(title), '') is not null),
  description text,
  is_required boolean not null default true,
  blocks_access boolean not null default false,
  owner_employee_record_id uuid,
  due_date date,
  state public.personnel_requirement_state not null default 'missing',
  blocker_reason text,
  sort_order integer not null check (sort_order >= 0),
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personnel_onboarding_requirements_plan_org_fkey
    foreign key (plan_id, organization_id)
    references public.personnel_onboarding_plans(id, organization_id) on delete cascade,
  constraint personnel_onboarding_requirements_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_onboarding_requirements_owner_org_fkey
    foreign key (owner_employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint personnel_onboarding_requirements_id_org_unique unique (id, organization_id),
  constraint personnel_onboarding_requirements_order_unique unique (plan_id, sort_order),
  constraint personnel_onboarding_requirements_blocker_shape check (
    state <> 'blocked' or nullif(btrim(blocker_reason), '') is not null
  )
);
create index personnel_onboarding_requirements_employee_state_idx
  on public.personnel_onboarding_requirements(employee_record_id, state, due_date);
create index personnel_onboarding_requirements_owner_state_idx
  on public.personnel_onboarding_requirements(owner_employee_record_id, state, due_date)
  where owner_employee_record_id is not null;

create table public.personnel_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  acknowledgement_kind public.personnel_acknowledgement_kind not null,
  personnel_document_id uuid,
  document_version_number integer,
  requirement_id uuid,
  requirement_version bigint,
  statement text not null check (nullif(btrim(statement), '') is not null),
  acknowledged_by uuid not null references auth.users(id) on delete restrict,
  acknowledged_at timestamptz not null default now(),
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint personnel_acknowledgements_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete cascade,
  constraint personnel_acknowledgements_document_org_fkey
    foreign key (personnel_document_id, organization_id)
    references public.personnel_documents(id, organization_id) on delete restrict,
  constraint personnel_acknowledgements_requirement_org_fkey
    foreign key (requirement_id, organization_id)
    references public.personnel_onboarding_requirements(id, organization_id) on delete restrict,
  constraint personnel_acknowledgements_operation_unique unique (organization_id, operation_id),
  constraint personnel_acknowledgements_target_shape check (
    (
      acknowledgement_kind = 'document_received'
      and personnel_document_id is not null
      and document_version_number is not null
      and requirement_id is null
      and requirement_version is null
    )
    or (
      acknowledgement_kind = 'requirement_completed'
      and requirement_id is not null
      and requirement_version is not null
      and personnel_document_id is null
      and document_version_number is null
    )
  )
);
create index personnel_acknowledgements_employee_idx
  on public.personnel_acknowledgements(employee_record_id, acknowledged_at desc);

create table public.personnel_requirement_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requirement_id uuid not null,
  personnel_document_id uuid references public.personnel_documents(id) on delete restrict,
  employee_capability_id uuid references public.employee_capabilities(id) on delete restrict,
  employment_condition_id uuid references public.employment_conditions(id) on delete restrict,
  work_schedule_id uuid references public.work_schedules(id) on delete restrict,
  team_membership_id uuid references public.team_memberships(id) on delete restrict,
  access_lifecycle_id uuid references public.personnel_access_lifecycles(id) on delete restrict,
  acknowledgement_id uuid references public.personnel_acknowledgements(id) on delete restrict,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint personnel_requirement_references_requirement_org_fkey
    foreign key (requirement_id, organization_id)
    references public.personnel_onboarding_requirements(id, organization_id) on delete cascade,
  constraint personnel_requirement_references_one_target check (
    num_nonnulls(
      personnel_document_id, employee_capability_id, employment_condition_id,
      work_schedule_id, team_membership_id, access_lifecycle_id, acknowledgement_id
    ) = 1
  )
);
create index personnel_requirement_references_requirement_idx
  on public.personnel_requirement_references(requirement_id);

-- One replay ledger gives every P1-24 mutation the same idempotency contract.
-- Business history remains in the existing employee and document event owners.
create table public.personnel_lifecycle_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  operation_kind text not null check (nullif(btrim(operation_kind), '') is not null),
  result_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint personnel_lifecycle_operations_unique unique (organization_id, operation_id)
);
create index personnel_lifecycle_operations_actor_idx
  on public.personnel_lifecycle_operations(actor_id, created_at desc);

create trigger personnel_access_lifecycles_updated_at before update
  on public.personnel_access_lifecycles for each row
  execute function public.update_updated_at_column();
create trigger personnel_employment_lifecycles_updated_at before update
  on public.personnel_employment_lifecycles for each row
  execute function public.update_updated_at_column();
create trigger personnel_documents_updated_at before update
  on public.personnel_documents for each row
  execute function public.update_updated_at_column();
create trigger personnel_onboarding_templates_updated_at before update
  on public.personnel_onboarding_templates for each row
  execute function public.update_updated_at_column();
create trigger personnel_onboarding_plans_updated_at before update
  on public.personnel_onboarding_plans for each row
  execute function public.update_updated_at_column();
create trigger personnel_onboarding_requirements_updated_at before update
  on public.personnel_onboarding_requirements for each row
  execute function public.update_updated_at_column();
