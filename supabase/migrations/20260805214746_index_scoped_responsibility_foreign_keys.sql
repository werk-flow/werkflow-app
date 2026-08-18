create index if not exists organization_responsibility_assignments_org_idx
  on public.organization_responsibility_assignments (organization_id);

create index if not exists organization_responsibility_configurations_created_by_idx
  on public.organization_responsibility_configurations (created_by);

create index if not exists organization_responsibility_delegations_delegator_idx
  on public.organization_responsibility_delegations (delegator_employee_record_id);

create index if not exists organization_responsibility_delegations_substitute_idx
  on public.organization_responsibility_delegations (substitute_employee_record_id);

create index if not exists organization_responsibility_delegations_created_by_idx
  on public.organization_responsibility_delegations (created_by);

create index if not exists organization_responsibility_events_primary_record_idx
  on public.organization_responsibility_events (primary_employee_record_id);

create index if not exists organization_responsibility_events_related_record_idx
  on public.organization_responsibility_events (related_employee_record_id);

create index if not exists organization_responsibility_events_configuration_idx
  on public.organization_responsibility_events (configuration_id);

create index if not exists organization_responsibility_events_created_by_idx
  on public.organization_responsibility_events (created_by);

create index if not exists organization_responsibility_events_delegation_idx
  on public.organization_responsibility_events (delegation_id);