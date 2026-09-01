-- P1-23: versioned time policies, accounts, period calculations/closes and
-- payroll-ready export artifacts. This migration is additive and creates no
-- organization data, account, period, result, export or historical backfill.

create extension if not exists btree_gist;

create type public.time_absence_treatment as enum ('paid', 'unpaid', 'informational');
create type public.time_finding_severity as enum ('informational', 'approval_required', 'close_blocked');
create type public.time_supplement_kind as enum ('night', 'sunday', 'public_holiday');
create type public.time_policy_warning_kind as enum (
  'break_duration', 'daily_duration', 'rest_duration',
  'night_work', 'sunday_work', 'public_holiday_work'
);
create type public.time_account_event_kind as enum (
  'opening_balance', 'manual_adjustment', 'expiry', 'payout',
  'period_close', 'period_reopen_reversal'
);
create type public.time_account_adjustment_kind as enum ('manual_adjustment', 'expiry', 'payout');
create type public.time_account_request_status as enum ('submitted', 'approved', 'rejected', 'superseded');
create type public.time_period_state as enum ('prepared', 'closed', 'reopened');
create type public.time_period_finding_kind as enum (
  'missing_policy', 'missing_opening_balance', 'missing_schedule',
  'open_session', 'recovery_session', 'missing_clock', 'overlap',
  'pending_correction', 'absence_conflict', 'unallocated_time',
  'positive_overtime', 'stale_calculation', 'break_duration',
  'daily_duration', 'rest_duration', 'night_work', 'sunday_work',
  'public_holiday_work'
);
create type public.time_period_finding_decision as enum ('acknowledged', 'approved', 'rejected');
create type public.payroll_mapping_value_kind as enum (
  'target', 'source_attendance', 'effective_attendance', 'credited_activity',
  'vacation', 'sickness', 'overtime', 'night_supplement',
  'sunday_supplement', 'public_holiday_supplement', 'manual_adjustment',
  'expiry', 'payout', 'opening_balance', 'closing_balance'
);
create type public.payroll_export_state as enum ('requested', 'generating', 'ready', 'failed', 'superseded');
create type public.payroll_export_scope as enum ('organization_period');

create table public.time_account_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  version bigint not null default 1 check (version > 0),
  retired_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_account_policies_name_check check (nullif(btrim(name), '') is not null),
  constraint time_account_policies_id_org_unique unique (id, organization_id)
);
create unique index time_account_policies_default_unique
  on public.time_account_policies(organization_id) where is_default and retired_at is null;
create unique index time_account_policies_name_unique
  on public.time_account_policies(organization_id, lower(btrim(name))) where retired_at is null;
create unique index time_account_policies_replident_idx
  on public.time_account_policies(id, organization_id);

create table public.time_account_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid not null,
  version integer not null check (version > 0),
  effective_from date not null,
  calculation_schema_version integer not null default 1 check (calculation_schema_version > 0),
  vacation_treatment public.time_absence_treatment not null,
  sickness_treatment public.time_absence_treatment not null,
  night_window_start time,
  night_window_end time,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint time_account_policy_versions_policy_org_fkey
    foreign key (policy_id, organization_id)
    references public.time_account_policies(id, organization_id) on delete cascade,
  constraint time_account_policy_versions_unique unique (policy_id, version),
  constraint time_account_policy_versions_operation_unique unique (organization_id, operation_id),
  constraint time_account_policy_versions_id_org_unique unique (id, organization_id),
  constraint time_account_policy_versions_night_shape check (
    (night_window_start is null and night_window_end is null)
    or (night_window_start is not null and night_window_end is not null and night_window_start <> night_window_end)
  )
);
create index time_account_policy_versions_effective_idx
  on public.time_account_policy_versions(policy_id, effective_from desc, version desc);

create table public.time_account_policy_credit_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_version_id uuid not null,
  activity_kind public.time_segment_kind not null,
  travel_route public.time_travel_route,
  travel_role public.time_travel_role,
  standby_context public.time_standby_context,
  credit_percentage smallint not null check (credit_percentage in (0, 50, 100)),
  created_at timestamptz not null default now(),
  constraint time_account_policy_credit_rules_version_org_fkey
    foreign key (policy_version_id, organization_id)
    references public.time_account_policy_versions(id, organization_id) on delete cascade,
  constraint time_account_policy_credit_rules_shape check (
    (activity_kind = 'travel' and travel_route is not null and travel_role is not null and standby_context is null)
    or (activity_kind = 'standby' and standby_context is not null and travel_route is null and travel_role is null)
    or (activity_kind not in ('travel', 'standby') and travel_route is null and travel_role is null and standby_context is null)
  )
);
create unique index time_account_policy_credit_rules_unique
  on public.time_account_policy_credit_rules(
    policy_version_id, activity_kind, travel_route, travel_role, standby_context
  ) nulls not distinct;

create table public.time_account_policy_supplement_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_version_id uuid not null,
  supplement_kind public.time_supplement_kind not null,
  activity_kind public.time_segment_kind not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  constraint time_account_policy_supplement_rules_version_org_fkey
    foreign key (policy_version_id, organization_id)
    references public.time_account_policy_versions(id, organization_id) on delete cascade,
  constraint time_account_policy_supplement_rules_unique unique (
    policy_version_id, supplement_kind, activity_kind
  )
);

create table public.time_account_policy_warning_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_version_id uuid not null,
  warning_kind public.time_policy_warning_kind not null,
  enabled boolean not null default false,
  severity public.time_finding_severity not null default 'informational',
  threshold_minutes integer check (threshold_minutes is null or threshold_minutes >= 0),
  created_at timestamptz not null default now(),
  constraint time_account_policy_warning_rules_version_org_fkey
    foreign key (policy_version_id, organization_id)
    references public.time_account_policy_versions(id, organization_id) on delete cascade,
  constraint time_account_policy_warning_rules_unique unique (policy_version_id, warning_kind)
);

create table public.time_account_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  policy_id uuid not null,
  valid_from date not null,
  valid_until date,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  assigned_by uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint time_account_policy_assignments_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_account_policy_assignments_policy_org_fkey
    foreign key (policy_id, organization_id)
    references public.time_account_policies(id, organization_id) on delete restrict,
  constraint time_account_policy_assignments_dates check (valid_until is null or valid_until >= valid_from),
  constraint time_account_policy_assignments_reason check (nullif(btrim(reason), '') is not null),
  constraint time_account_policy_assignments_operation_unique unique (organization_id, operation_id),
  constraint time_account_policy_assignments_no_overlap exclude using gist (
    employee_record_id with =,
    daterange(valid_from, coalesce(valid_until + 1, 'infinity'::date), '[)') with &&
  )
);
create index time_account_policy_assignments_lookup_idx
  on public.time_account_policy_assignments(organization_id, employee_record_id, valid_from desc);

create table public.time_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  version bigint not null default 1 check (version > 0),
  opened_on date not null,
  current_balance_minutes integer not null default 0,
  last_closed_period_end_date date,
  opened_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_accounts_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_accounts_employee_unique unique (organization_id, employee_record_id),
  constraint time_accounts_id_org_unique unique (id, organization_id)
);
create unique index time_accounts_replident_idx on public.time_accounts(id, organization_id);

create table public.time_account_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  employee_record_id uuid not null,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  version bigint not null default 1 check (version > 0),
  adjustment_kind public.time_account_adjustment_kind not null,
  minutes integer not null check (minutes <> 0),
  effective_date date not null,
  reason text not null,
  status public.time_account_request_status not null default 'submitted',
  requested_by uuid not null references auth.users(id) on delete restrict,
  decided_by uuid references auth.users(id) on delete restrict,
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_account_adjustment_requests_account_org_fkey
    foreign key (account_id, organization_id)
    references public.time_accounts(id, organization_id) on delete restrict,
  constraint time_account_adjustment_requests_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_account_adjustment_requests_operation_unique unique (organization_id, operation_id),
  constraint time_account_adjustment_requests_id_org_unique unique (id, organization_id),
  constraint time_account_adjustment_requests_reason check (nullif(btrim(reason), '') is not null),
  constraint time_account_adjustment_requests_decision_shape check (
    (status = 'submitted' and decided_by is null and decision_reason is null and decided_at is null)
    or (status <> 'submitted' and decided_by is not null and nullif(btrim(decision_reason), '') is not null and decided_at is not null)
  )
);
create unique index time_account_adjustment_requests_replident_idx
  on public.time_account_adjustment_requests(id, organization_id);
create index time_account_adjustment_requests_status_idx
  on public.time_account_adjustment_requests(organization_id, status, created_at desc);

create table public.time_account_adjustment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  event_type text not null check (event_type in ('submitted', 'approved', 'rejected', 'superseded')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  reason text,
  responsibility_snapshot jsonb,
  occurred_at timestamptz not null default now(),
  constraint time_account_adjustment_events_request_org_fkey
    foreign key (request_id, organization_id)
    references public.time_account_adjustment_requests(id, organization_id) on delete cascade,
  constraint time_account_adjustment_events_operation_unique unique (organization_id, operation_id)
);

create table public.time_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start_date date not null,
  period_end_date date not null,
  timezone text not null default 'Europe/Berlin' check (timezone = 'Europe/Berlin'),
  state public.time_period_state not null default 'prepared',
  version bigint not null default 1 check (version > 0),
  current_calculation_id uuid,
  current_close_version_id uuid,
  prepared_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_periods_id_org_unique unique (id, organization_id),
  constraint time_periods_boundary_unique unique (organization_id, period_start_date, period_end_date),
  constraint time_periods_calendar_month_check check (
    period_start_date = date_trunc('month', period_start_date)::date
    and period_end_date = (date_trunc('month', period_start_date) + interval '1 month - 1 day')::date
  )
);
create unique index time_periods_replident_idx on public.time_periods(id, organization_id);
create index time_periods_org_state_idx on public.time_periods(organization_id, state, period_start_date desc);

create table public.time_period_calculations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null,
  version integer not null check (version > 0),
  calculation_schema_version integer not null default 1 check (calculation_schema_version > 0),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  target_minutes bigint not null default 0,
  source_seconds numeric(18,3) not null default 0,
  credited_minutes bigint not null default 0,
  absence_minutes bigint not null default 0,
  overtime_minutes bigint not null default 0,
  account_event_minutes bigint not null default 0,
  generated_by uuid not null references auth.users(id) on delete restrict,
  generated_at timestamptz not null default now(),
  constraint time_period_calculations_period_org_fkey
    foreign key (period_id, organization_id)
    references public.time_periods(id, organization_id) on delete cascade,
  constraint time_period_calculations_unique unique (period_id, version),
  constraint time_period_calculations_id_org_unique unique (id, organization_id)
);

create table public.time_period_employee_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  calculation_id uuid not null,
  employee_record_id uuid not null,
  policy_version_id uuid,
  previous_balance_minutes integer not null,
  target_minutes integer not null,
  source_seconds numeric(18,3) not null,
  source_minutes integer not null,
  credited_minutes integer not null,
  vacation_minutes integer not null,
  sickness_minutes integer not null,
  account_event_minutes integer not null,
  period_delta_minutes integer not null,
  overtime_candidate_minutes integer not null check (overtime_candidate_minutes >= 0),
  closing_balance_minutes integer not null,
  authoritative_targets boolean not null,
  created_at timestamptz not null default now(),
  constraint time_period_employee_results_calculation_org_fkey
    foreign key (calculation_id, organization_id)
    references public.time_period_calculations(id, organization_id) on delete cascade,
  constraint time_period_employee_results_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_period_employee_results_policy_org_fkey
    foreign key (policy_version_id, organization_id)
    references public.time_account_policy_versions(id, organization_id) on delete restrict,
  constraint time_period_employee_results_unique unique (calculation_id, employee_record_id),
  constraint time_period_employee_results_id_org_unique unique (id, organization_id)
);
create index time_period_employee_results_employee_idx
  on public.time_period_employee_results(organization_id, employee_record_id, created_at desc);

create table public.time_period_daily_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_result_id uuid not null,
  employee_record_id uuid not null,
  local_date date not null,
  activity_kind public.time_segment_kind not null,
  travel_route public.time_travel_route,
  travel_role public.time_travel_role,
  standby_context public.time_standby_context,
  credit_percentage smallint not null check (credit_percentage in (0, 50, 100)),
  source_seconds numeric(18,3) not null check (source_seconds >= 0),
  source_minutes integer not null check (source_minutes >= 0),
  credited_seconds numeric(18,3) not null check (credited_seconds >= 0),
  credited_minutes integer not null check (credited_minutes >= 0),
  rounding_delta_seconds numeric(18,3) not null,
  target_minutes integer not null default 0,
  vacation_minutes integer not null default 0,
  sickness_minutes integer not null default 0,
  night_minutes integer not null default 0,
  sunday_minutes integer not null default 0,
  public_holiday_minutes integer not null default 0,
  created_at timestamptz not null default now(),
  constraint time_period_daily_results_employee_result_org_fkey
    foreign key (employee_result_id, organization_id)
    references public.time_period_employee_results(id, organization_id) on delete cascade,
  constraint time_period_daily_results_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_period_daily_results_id_org_unique unique (id, organization_id),
  constraint time_period_daily_results_context_shape check (
    (activity_kind = 'travel' and travel_route is not null and travel_role is not null and standby_context is null)
    or (activity_kind = 'standby' and standby_context is not null and travel_route is null and travel_role is null)
    or (activity_kind not in ('travel', 'standby') and travel_route is null and travel_role is null and standby_context is null)
  )
);
create unique index time_period_daily_results_unique
  on public.time_period_daily_results(
    employee_result_id, local_date, activity_kind, travel_route, travel_role, standby_context
  ) nulls not distinct;

create table public.time_period_result_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_result_id uuid not null,
  daily_result_id uuid,
  source_kind text not null check (source_kind in (
    'legacy_entry', 'time_session', 'time_segment', 'correction_application',
    'work_schedule', 'employment_condition', 'vacation', 'sickness',
    'holiday', 'closure_day', 'account_event'
  )),
  source_id uuid,
  source_key text,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint time_period_result_sources_employee_result_org_fkey
    foreign key (employee_result_id, organization_id)
    references public.time_period_employee_results(id, organization_id) on delete cascade,
  constraint time_period_result_sources_daily_result_org_fkey
    foreign key (daily_result_id, organization_id)
    references public.time_period_daily_results(id, organization_id) on delete cascade,
  constraint time_period_result_sources_identity check (num_nonnulls(source_id, source_key) = 1)
);
create unique index time_period_result_sources_unique
  on public.time_period_result_sources(
    employee_result_id, daily_result_id, source_kind, source_id, source_key
  ) nulls not distinct;

create table public.time_period_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  calculation_id uuid not null,
  employee_record_id uuid,
  local_date date,
  finding_kind public.time_period_finding_kind not null,
  severity public.time_finding_severity not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint time_period_findings_calculation_org_fkey
    foreign key (calculation_id, organization_id)
    references public.time_period_calculations(id, organization_id) on delete cascade,
  constraint time_period_findings_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_period_findings_id_org_unique unique (id, organization_id)
);
create index time_period_findings_lookup_idx
  on public.time_period_findings(organization_id, calculation_id, severity, employee_record_id);

create table public.time_period_finding_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  decision public.time_period_finding_decision not null,
  reason text not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  responsibility_snapshot jsonb not null,
  decided_at timestamptz not null default now(),
  constraint time_period_finding_decisions_finding_org_fkey
    foreign key (finding_id, organization_id)
    references public.time_period_findings(id, organization_id) on delete cascade,
  constraint time_period_finding_decisions_reason check (nullif(btrim(reason), '') is not null),
  constraint time_period_finding_decisions_operation_unique unique (organization_id, operation_id)
);
create unique index time_period_finding_decisions_terminal_unique
  on public.time_period_finding_decisions(finding_id)
  where decision in ('acknowledged', 'approved');

create table public.time_period_close_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null,
  calculation_id uuid not null,
  version integer not null check (version > 0),
  supersedes_close_version_id uuid,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  opening_balance_total_minutes bigint not null,
  period_delta_total_minutes bigint not null,
  closing_balance_total_minutes bigint not null,
  closed_by uuid not null references auth.users(id) on delete restrict,
  closed_at timestamptz not null default now(),
  constraint time_period_close_versions_period_org_fkey
    foreign key (period_id, organization_id)
    references public.time_periods(id, organization_id) on delete cascade,
  constraint time_period_close_versions_calculation_org_fkey
    foreign key (calculation_id, organization_id)
    references public.time_period_calculations(id, organization_id) on delete restrict,
  constraint time_period_close_versions_supersedes_org_fkey
    foreign key (supersedes_close_version_id, organization_id)
    references public.time_period_close_versions(id, organization_id) on delete restrict,
  constraint time_period_close_versions_unique unique (period_id, version),
  constraint time_period_close_versions_calculation_unique unique (calculation_id),
  constraint time_period_close_versions_id_org_unique unique (id, organization_id)
);

alter table public.time_periods
  add constraint time_periods_current_calculation_org_fkey
  foreign key (current_calculation_id, organization_id)
  references public.time_period_calculations(id, organization_id) deferrable initially deferred;
alter table public.time_periods
  add constraint time_periods_current_close_org_fkey
  foreign key (current_close_version_id, organization_id)
  references public.time_period_close_versions(id, organization_id) deferrable initially deferred;

create table public.time_account_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  employee_record_id uuid not null,
  event_kind public.time_account_event_kind not null,
  effective_date date not null,
  minutes integer not null,
  reason text not null,
  adjustment_request_id uuid,
  close_version_id uuid,
  reverses_event_id uuid,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint time_account_events_account_org_fkey
    foreign key (account_id, organization_id)
    references public.time_accounts(id, organization_id) on delete restrict,
  constraint time_account_events_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_account_events_request_org_fkey
    foreign key (adjustment_request_id, organization_id)
    references public.time_account_adjustment_requests(id, organization_id) on delete restrict,
  constraint time_account_events_close_org_fkey
    foreign key (close_version_id, organization_id)
    references public.time_period_close_versions(id, organization_id) on delete restrict,
  constraint time_account_events_reverses_org_fkey
    foreign key (reverses_event_id, organization_id)
    references public.time_account_events(id, organization_id) on delete restrict,
  constraint time_account_events_id_org_unique unique (id, organization_id),
  constraint time_account_events_operation_unique unique (organization_id, operation_id),
  constraint time_account_events_reason check (nullif(btrim(reason), '') is not null),
  constraint time_account_events_shape check (
    (event_kind = 'opening_balance' and adjustment_request_id is null and close_version_id is null and reverses_event_id is null)
    or (event_kind in ('manual_adjustment', 'expiry', 'payout') and adjustment_request_id is not null and close_version_id is null and reverses_event_id is null)
    or (event_kind = 'period_close' and adjustment_request_id is null and close_version_id is not null and reverses_event_id is null)
    or (event_kind = 'period_reopen_reversal' and adjustment_request_id is null and close_version_id is not null and reverses_event_id is not null)
  )
);
create unique index time_account_events_opening_unique
  on public.time_account_events(account_id) where event_kind = 'opening_balance';
create unique index time_account_events_adjustment_unique
  on public.time_account_events(adjustment_request_id) where adjustment_request_id is not null;
create unique index time_account_events_close_unique
  on public.time_account_events(account_id, close_version_id, event_kind) where close_version_id is not null;
create unique index time_account_events_reversal_unique
  on public.time_account_events(reverses_event_id) where reverses_event_id is not null;
create index time_account_events_balance_idx
  on public.time_account_events(organization_id, employee_record_id, effective_date, created_at, id);

create table public.time_period_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null,
  event_type text not null check (event_type in ('prepared', 'recalculated', 'closed', 'reopened', 'superseded')),
  calculation_id uuid,
  close_version_id uuid,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint time_period_events_period_org_fkey
    foreign key (period_id, organization_id)
    references public.time_periods(id, organization_id) on delete cascade,
  constraint time_period_events_calculation_org_fkey
    foreign key (calculation_id, organization_id)
    references public.time_period_calculations(id, organization_id) on delete restrict,
  constraint time_period_events_close_org_fkey
    foreign key (close_version_id, organization_id)
    references public.time_period_close_versions(id, organization_id) on delete restrict,
  constraint time_period_events_operation_unique unique (organization_id, operation_id)
);

create table public.payroll_mapping_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  current_version_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_mapping_profiles_org_unique unique (organization_id),
  constraint payroll_mapping_profiles_id_org_unique unique (id, organization_id)
);
create unique index payroll_mapping_profiles_replident_idx
  on public.payroll_mapping_profiles(id, organization_id);

create table public.payroll_mapping_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null,
  version integer not null check (version > 0),
  generator_compatibility_version text not null default 'p1-23-v1',
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  constraint payroll_mapping_versions_profile_org_fkey
    foreign key (profile_id, organization_id)
    references public.payroll_mapping_profiles(id, organization_id) on delete cascade,
  constraint payroll_mapping_versions_unique unique (profile_id, version),
  constraint payroll_mapping_versions_operation_unique unique (organization_id, operation_id),
  constraint payroll_mapping_versions_id_org_unique unique (id, organization_id)
);
alter table public.payroll_mapping_profiles
  add constraint payroll_mapping_profiles_current_version_org_fkey
  foreign key (current_version_id, organization_id)
  references public.payroll_mapping_versions(id, organization_id) deferrable initially deferred;

create table public.payroll_employee_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mapping_version_id uuid not null,
  employee_record_id uuid not null,
  external_employee_reference text not null,
  created_at timestamptz not null default now(),
  constraint payroll_employee_mappings_version_org_fkey
    foreign key (mapping_version_id, organization_id)
    references public.payroll_mapping_versions(id, organization_id) on delete cascade,
  constraint payroll_employee_mappings_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint payroll_employee_mappings_employee_unique unique (mapping_version_id, employee_record_id),
  constraint payroll_employee_mappings_external_unique unique (mapping_version_id, external_employee_reference),
  constraint payroll_employee_mappings_external_check check (nullif(btrim(external_employee_reference), '') is not null)
);

create table public.payroll_code_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mapping_version_id uuid not null,
  value_kind public.payroll_mapping_value_kind not null,
  activity_kind public.time_segment_kind,
  output_code text not null,
  created_at timestamptz not null default now(),
  constraint payroll_code_mappings_version_org_fkey
    foreign key (mapping_version_id, organization_id)
    references public.payroll_mapping_versions(id, organization_id) on delete cascade,
  constraint payroll_code_mappings_unique unique (mapping_version_id, value_kind, activity_kind),
  constraint payroll_code_mappings_output_check check (nullif(btrim(output_code), '') is not null),
  constraint payroll_code_mappings_activity_shape check (
    (value_kind = 'credited_activity' and activity_kind is not null)
    or (value_kind <> 'credited_activity' and activity_kind is null)
  )
);

create table public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null,
  close_version_id uuid not null,
  mapping_version_id uuid not null,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  version integer not null check (version > 0),
  state public.payroll_export_state not null default 'requested',
  scope public.payroll_export_scope not null default 'organization_period',
  generator_version text not null,
  content_fingerprint text not null check (content_fingerprint ~ '^[0-9a-f]{64}$'),
  zip_sha256 text check (zip_sha256 is null or zip_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  document_id uuid,
  supersedes_export_id uuid,
  requested_by uuid not null references auth.users(id) on delete restrict,
  ready_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_exports_period_org_fkey
    foreign key (period_id, organization_id)
    references public.time_periods(id, organization_id) on delete restrict,
  constraint payroll_exports_close_org_fkey
    foreign key (close_version_id, organization_id)
    references public.time_period_close_versions(id, organization_id) on delete restrict,
  constraint payroll_exports_mapping_org_fkey
    foreign key (mapping_version_id, organization_id)
    references public.payroll_mapping_versions(id, organization_id) on delete restrict,
  constraint payroll_exports_document_org_fkey
    foreign key (document_id, organization_id)
    references public.documents(id, organization_id) on delete restrict,
  constraint payroll_exports_supersedes_org_fkey
    foreign key (supersedes_export_id, organization_id)
    references public.payroll_exports(id, organization_id) on delete restrict,
  constraint payroll_exports_operation_unique unique (organization_id, operation_id),
  constraint payroll_exports_version_unique unique (close_version_id, version),
  constraint payroll_exports_id_org_unique unique (id, organization_id),
  constraint payroll_exports_state_shape check (
    (state in ('requested', 'generating') and document_id is null and zip_sha256 is null and size_bytes is null and ready_at is null)
    or (state in ('ready', 'superseded') and document_id is not null and zip_sha256 is not null and size_bytes is not null and ready_at is not null and failure_reason is null)
    or (state = 'failed' and document_id is null and ready_at is null and nullif(btrim(failure_reason), '') is not null)
  )
);
create unique index payroll_exports_replident_idx on public.payroll_exports(id, organization_id);
create unique index payroll_exports_successor_unique
  on public.payroll_exports(supersedes_export_id) where supersedes_export_id is not null;
create index payroll_exports_period_idx on public.payroll_exports(organization_id, period_id, created_at desc);

create table public.payroll_export_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_id uuid not null,
  event_type text not null check (event_type in ('requested', 'generating', 'ready', 'failed', 'superseded')),
  operation_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint payroll_export_events_export_org_fkey
    foreign key (export_id, organization_id)
    references public.payroll_exports(id, organization_id) on delete cascade,
  constraint payroll_export_events_operation_unique unique (organization_id, operation_id)
);

create or replace function app_private.guard_p1_23_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'p1_23_history_immutable';
end;
$$;

create trigger guard_time_account_policy_versions_immutable before update on public.time_account_policy_versions
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_account_policy_credit_rules_immutable before update on public.time_account_policy_credit_rules
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_account_policy_supplement_rules_immutable before update on public.time_account_policy_supplement_rules
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_account_policy_warning_rules_immutable before update on public.time_account_policy_warning_rules
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_account_events_immutable before update on public.time_account_events
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_account_adjustment_events_immutable before update on public.time_account_adjustment_events
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_period_calculations_immutable before update on public.time_period_calculations
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_period_employee_results_immutable before update on public.time_period_employee_results
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_period_daily_results_immutable before update on public.time_period_daily_results
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_period_result_sources_immutable before update on public.time_period_result_sources
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_period_findings_immutable before update on public.time_period_findings
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_period_finding_decisions_immutable before update on public.time_period_finding_decisions
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_period_close_versions_immutable before update on public.time_period_close_versions
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_time_period_events_immutable before update on public.time_period_events
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_payroll_mapping_versions_immutable before update on public.payroll_mapping_versions
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_payroll_employee_mappings_immutable before update on public.payroll_employee_mappings
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_payroll_code_mappings_immutable before update on public.payroll_code_mappings
  for each row execute function app_private.guard_p1_23_immutable();
create trigger guard_payroll_export_events_immutable before update on public.payroll_export_events
  for each row execute function app_private.guard_p1_23_immutable();

create trigger time_account_policies_updated_at before update on public.time_account_policies
  for each row execute function public.update_time_entries_updated_at();
create trigger time_accounts_updated_at before update on public.time_accounts
  for each row execute function public.update_time_entries_updated_at();
create trigger time_account_adjustment_requests_updated_at before update on public.time_account_adjustment_requests
  for each row execute function public.update_time_entries_updated_at();
create trigger time_periods_updated_at before update on public.time_periods
  for each row execute function public.update_time_entries_updated_at();
create trigger payroll_mapping_profiles_updated_at before update on public.payroll_mapping_profiles
  for each row execute function public.update_time_entries_updated_at();
create trigger payroll_exports_updated_at before update on public.payroll_exports
  for each row execute function public.update_time_entries_updated_at();

-- P1-23 action-time authorization helpers. They are private and execute only
-- inside service-role mutation functions.
create or replace function app_private.is_p1_23_org_admin(p_organization_id uuid, p_actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id and member.role = 'admin'
  );
$$;

create or replace function app_private.is_p1_23_org_manager(p_organization_id uuid, p_actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id and member.role in ('admin', 'buero')
  );
$$;

create or replace function app_private.is_p1_23_time_holder(p_organization_id uuid, p_actor_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  actor_employee_id uuid;
  latest_configuration_id uuid;
  business_date date := (current_timestamp at time zone 'Europe/Berlin')::date;
begin
  select employee.id into actor_employee_id
  from public.employee_records employee
  join public.organization_members member
    on member.organization_id = employee.organization_id and member.user_id = employee.user_id
  where employee.organization_id = p_organization_id and employee.user_id = p_actor_id
    and (employee.exit_date is null or employee.exit_date >= business_date);
  if actor_employee_id is null then return false; end if;

  select configuration.id into latest_configuration_id
  from public.organization_responsibility_configurations configuration
  where configuration.organization_id = p_organization_id
    and configuration.responsibility = 'time_approval'
    and configuration.effective_from <= current_timestamp
  order by configuration.effective_from desc, configuration.created_at desc, configuration.id desc
  limit 1;

  if latest_configuration_id is null then
    return app_private.is_p1_23_org_manager(p_organization_id, p_actor_id);
  end if;

  if exists (
    select 1 from public.organization_responsibility_assignments assignment
    where assignment.configuration_id = latest_configuration_id
      and assignment.employee_record_id = actor_employee_id
  ) then return true; end if;

  return exists (
    select 1
    from public.organization_responsibility_delegations delegation
    join public.organization_responsibility_assignments base_assignment
      on base_assignment.configuration_id = latest_configuration_id
     and base_assignment.employee_record_id = delegation.delegator_employee_record_id
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'time_approval'
      and delegation.substitute_employee_record_id = actor_employee_id
      and delegation.valid_from <= business_date and delegation.valid_until >= business_date
      and (delegation.revoked_from is null or delegation.revoked_from > business_date)
  );
end;
$$;

create or replace function app_private.can_p1_23_approve_employee(
  p_organization_id uuid, p_actor_id uuid, p_employee_record_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.is_p1_23_time_holder(p_organization_id, p_actor_id)
    and not exists (
      select 1 from public.employee_records employee
      where employee.id = p_employee_record_id and employee.organization_id = p_organization_id
        and employee.user_id = p_actor_id
    );
$$;

revoke all on function app_private.is_p1_23_org_admin(uuid, uuid) from public;
revoke all on function app_private.is_p1_23_org_manager(uuid, uuid) from public;
revoke all on function app_private.is_p1_23_time_holder(uuid, uuid) from public;
revoke all on function app_private.can_p1_23_approve_employee(uuid, uuid, uuid) from public;

-- Read policies. Server mutations use service-role RPCs added in the following
-- migration. Employees can read only account/result rows for their own record.
alter table public.time_account_policies enable row level security;
alter table public.time_account_policy_versions enable row level security;
alter table public.time_account_policy_credit_rules enable row level security;
alter table public.time_account_policy_supplement_rules enable row level security;
alter table public.time_account_policy_warning_rules enable row level security;
alter table public.time_account_policy_assignments enable row level security;
alter table public.time_accounts enable row level security;
alter table public.time_account_events enable row level security;
alter table public.time_account_adjustment_requests enable row level security;
alter table public.time_account_adjustment_events enable row level security;
alter table public.time_periods enable row level security;
alter table public.time_period_calculations enable row level security;
alter table public.time_period_employee_results enable row level security;
alter table public.time_period_daily_results enable row level security;
alter table public.time_period_result_sources enable row level security;
alter table public.time_period_findings enable row level security;
alter table public.time_period_finding_decisions enable row level security;
alter table public.time_period_close_versions enable row level security;
alter table public.time_period_events enable row level security;
alter table public.payroll_mapping_profiles enable row level security;
alter table public.payroll_mapping_versions enable row level security;
alter table public.payroll_employee_mappings enable row level security;
alter table public.payroll_code_mappings enable row level security;
alter table public.payroll_exports enable row level security;
alter table public.payroll_export_events enable row level security;

create policy time_account_policy_managers_select on public.time_account_policies for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy time_account_policy_versions_managers_select on public.time_account_policy_versions for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy time_account_policy_credit_rules_managers_select on public.time_account_policy_credit_rules for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy time_account_policy_supplement_rules_managers_select on public.time_account_policy_supplement_rules for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy time_account_policy_warning_rules_managers_select on public.time_account_policy_warning_rules for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy time_account_policy_assignments_managers_select on public.time_account_policy_assignments for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

create policy time_accounts_permitted_select on public.time_accounts for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or exists (select 1 from public.employee_records employee where employee.id = employee_record_id and employee.user_id = (select auth.uid()))
);
create policy time_account_events_permitted_select on public.time_account_events for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or exists (select 1 from public.employee_records employee where employee.id = employee_record_id and employee.user_id = (select auth.uid()))
);
create policy time_account_adjustment_requests_permitted_select on public.time_account_adjustment_requests for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or requested_by = (select auth.uid())
  or exists (select 1 from public.employee_records employee where employee.id = employee_record_id and employee.user_id = (select auth.uid()))
);
create policy time_account_adjustment_events_permitted_select on public.time_account_adjustment_events for select to authenticated using (
  exists (select 1 from public.time_account_adjustment_requests request
    where request.id = request_id and request.organization_id = organization_id
      and (request.requested_by = (select auth.uid())
        or request.organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
        or exists (select 1 from public.employee_records employee where employee.id = request.employee_record_id and employee.user_id = (select auth.uid()))))
);

create policy time_periods_managers_select on public.time_periods for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
);
create policy time_period_calculations_managers_select on public.time_period_calculations for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
);
create policy time_period_employee_results_permitted_select on public.time_period_employee_results for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
  or exists (select 1 from public.employee_records employee where employee.id = employee_record_id and employee.user_id = (select auth.uid()))
);
create policy time_period_daily_results_permitted_select on public.time_period_daily_results for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
  or exists (select 1 from public.employee_records employee where employee.id = employee_record_id and employee.user_id = (select auth.uid()))
);
create policy time_period_result_sources_permitted_select on public.time_period_result_sources for select to authenticated using (
  exists (select 1 from public.time_period_employee_results result
    where result.id = employee_result_id and result.organization_id = organization_id
      and (result.organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
        or app_private.is_p1_23_time_holder(result.organization_id, (select auth.uid()))
        or exists (select 1 from public.employee_records employee where employee.id = result.employee_record_id and employee.user_id = (select auth.uid()))))
);
create policy time_period_findings_permitted_select on public.time_period_findings for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
  or exists (select 1 from public.employee_records employee where employee.id = employee_record_id and employee.user_id = (select auth.uid()))
);
create policy time_period_finding_decisions_permitted_select on public.time_period_finding_decisions for select to authenticated using (
  exists (select 1 from public.time_period_findings finding
    where finding.id = finding_id and finding.organization_id = organization_id
      and (finding.organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
        or app_private.is_p1_23_time_holder(finding.organization_id, (select auth.uid()))
        or exists (select 1 from public.employee_records employee where employee.id = finding.employee_record_id and employee.user_id = (select auth.uid()))))
);
create policy time_period_close_versions_managers_select on public.time_period_close_versions for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
  or exists (select 1 from public.time_period_employee_results result
    where result.calculation_id = calculation_id and exists (
      select 1 from public.employee_records employee
      where employee.id = result.employee_record_id and employee.user_id = (select auth.uid())))
);
create policy time_period_events_managers_select on public.time_period_events for select to authenticated using (
  organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
);

create policy payroll_mapping_profiles_managers_select on public.payroll_mapping_profiles for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy payroll_mapping_versions_managers_select on public.payroll_mapping_versions for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy payroll_employee_mappings_managers_select on public.payroll_employee_mappings for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy payroll_code_mappings_managers_select on public.payroll_code_mappings for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy payroll_exports_managers_select on public.payroll_exports for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
create policy payroll_export_events_managers_select on public.payroll_export_events for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

revoke all on public.time_account_policies, public.time_account_policy_versions,
  public.time_account_policy_credit_rules, public.time_account_policy_supplement_rules,
  public.time_account_policy_warning_rules, public.time_account_policy_assignments,
  public.time_accounts, public.time_account_events, public.time_account_adjustment_requests,
  public.time_account_adjustment_events, public.time_periods, public.time_period_calculations,
  public.time_period_employee_results, public.time_period_daily_results,
  public.time_period_result_sources, public.time_period_findings,
  public.time_period_finding_decisions, public.time_period_close_versions,
  public.time_period_events, public.payroll_mapping_profiles, public.payroll_mapping_versions,
  public.payroll_employee_mappings, public.payroll_code_mappings,
  public.payroll_exports, public.payroll_export_events from anon, authenticated;
grant select on public.time_account_policies, public.time_account_policy_versions,
  public.time_account_policy_credit_rules, public.time_account_policy_supplement_rules,
  public.time_account_policy_warning_rules, public.time_account_policy_assignments,
  public.time_accounts, public.time_account_events, public.time_account_adjustment_requests,
  public.time_account_adjustment_events, public.time_periods, public.time_period_calculations,
  public.time_period_employee_results, public.time_period_daily_results,
  public.time_period_result_sources, public.time_period_findings,
  public.time_period_finding_decisions, public.time_period_close_versions,
  public.time_period_events, public.payroll_mapping_profiles, public.payroll_mapping_versions,
  public.payroll_employee_mappings, public.payroll_code_mappings,
  public.payroll_exports, public.payroll_export_events to authenticated;
grant all on public.time_account_policies, public.time_account_policy_versions,
  public.time_account_policy_credit_rules, public.time_account_policy_supplement_rules,
  public.time_account_policy_warning_rules, public.time_account_policy_assignments,
  public.time_accounts, public.time_account_events, public.time_account_adjustment_requests,
  public.time_account_adjustment_events, public.time_periods, public.time_period_calculations,
  public.time_period_employee_results, public.time_period_daily_results,
  public.time_period_result_sources, public.time_period_findings,
  public.time_period_finding_decisions, public.time_period_close_versions,
  public.time_period_events, public.payroll_mapping_profiles, public.payroll_mapping_versions,
  public.payroll_employee_mappings, public.payroll_code_mappings,
  public.payroll_exports, public.payroll_export_events to service_role;

alter table public.time_account_policies replica identity using index time_account_policies_replident_idx;
alter table public.time_accounts replica identity using index time_accounts_replident_idx;
alter table public.time_account_adjustment_requests replica identity using index time_account_adjustment_requests_replident_idx;
alter table public.time_periods replica identity using index time_periods_replident_idx;
alter table public.payroll_mapping_profiles replica identity using index payroll_mapping_profiles_replident_idx;
alter table public.payroll_exports replica identity using index payroll_exports_replident_idx;
alter publication supabase_realtime add table public.time_account_policies;
alter publication supabase_realtime add table public.time_accounts;
alter publication supabase_realtime add table public.time_account_adjustment_requests;
alter publication supabase_realtime add table public.time_periods;
alter publication supabase_realtime add table public.payroll_mapping_profiles;
alter publication supabase_realtime add table public.payroll_exports;
