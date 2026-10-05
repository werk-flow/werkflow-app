-- Record numbers past 999 in one year (or past MA-999).
--
-- Every generator padded its sequence with lpad(n, 3, '0'). lpad truncates a
-- longer value, so the 1000th number became "...-100" and collided with the
-- unique number of an existing record: the 1000th Auftrag, Projekt, Anfrage,
-- Anlage, Servicefall, Wartungsvertrag or Wartungsplan of a year, and the
-- 1000th personnel record, could not be created. The job and request
-- generators also read only three-digit numbers, so after the padding fix
-- they would have restarted at 1000. Numbers keep at least three digits and
-- grow beyond them; existing numbers are unchanged.

create or replace function public.generate_job_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_year text := extract(year from now())::text;
  next_seq integer;
begin
  select coalesce(
    max(
      case
        when job_number ~ ('^AUF-' || current_year || '-[0-9]{3,}$')
          then substring(job_number from '[0-9]+$')::integer
        else null
      end
    ),
    0
  ) + 1
  into next_seq
  from jobs
  where organization_id = p_org_id;

  return 'AUF-' || current_year || '-' || lpad(next_seq::text, greatest(3, length(next_seq::text)), '0');
end;
$function$;

create or replace function public.generate_request_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_year text := extract(year from now())::text;
  next_seq integer;
begin
  select coalesce(
    max(
      case
        when request_number ~ ('^ANF-' || current_year || '-[0-9]{3,}$')
          then substring(request_number from '[0-9]+$')::integer
        else null
      end
    ),
    0
  ) + 1
  into next_seq
  from client_requests
  where organization_id = p_org_id;

  return 'ANF-' || current_year || '-' || lpad(next_seq::text, greatest(3, length(next_seq::text)), '0');
end;
$function$;

create or replace function public.generate_project_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_year text := to_char(now(), 'YYYY');
  next_seq integer;
begin
  select coalesce(max(
    case
      when project_number ~ ('^PRJ-' || current_year || '-[0-9]+$')
      then cast(substring(project_number from '[0-9]+$') as integer)
      else 0
    end
  ), 0) + 1
  into next_seq
  from projects
  where organization_id = p_org_id;

  return 'PRJ-' || current_year || '-' || lpad(next_seq::text, greatest(3, length(next_seq::text)), '0');
end;
$function$;

create or replace function public.generate_personnel_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  next_seq integer;
begin
  select coalesce(
    max(
      case
        when employee_number ~ '^MA-[0-9]{3,}$'
          then substring(employee_number from 4)::integer
        else null
      end
    ),
    0
  ) + 1
  into next_seq
  from employee_records
  where organization_id = p_org_id;

  return 'MA-' || lpad(next_seq::text, greatest(3, length(next_seq::text)), '0');
end;
$function$;

create or replace function app_private.next_installed_equipment_number(
  p_organization_id uuid
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
  v_next integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':installed-equipment-number', 0)
  );
  select coalesce(max(
    substring(equipment.equipment_number from ('^ANL-' || v_year || '-([0-9]+)$'))::integer
  ), 0) + 1
  into v_next
  from public.installed_equipment equipment
  where equipment.organization_id = p_organization_id
    and equipment.equipment_number ~ ('^ANL-' || v_year || '-[0-9]+$');
  return 'ANL-' || v_year || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end;
$$;

create or replace function app_private.next_service_case_number(
  p_organization_id uuid
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
  v_next integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':service-case-number', 0)
  );
  select coalesce(max(
    substring(service_case.case_number from ('^SRV-' || v_year || '-([0-9]+)$'))::integer
  ), 0) + 1
  into v_next
  from public.service_cases service_case
  where service_case.organization_id = p_organization_id
    and service_case.case_number ~ ('^SRV-' || v_year || '-[0-9]+$');
  return 'SRV-' || v_year || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end;
$$;

create or replace function app_private.next_maintenance_number(
  p_organization_id uuid,
  p_kind text
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
  v_prefix text;
  v_next integer;
begin
  if p_kind = 'coverage' then v_prefix := 'WDV';
  elsif p_kind = 'plan' then v_prefix := 'WPL';
  else raise exception 'maintenance_number_kind_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':maintenance-number:' || p_kind, 0)
  );
  if p_kind = 'coverage' then
    select coalesce(max(substring(coverage.coverage_number from
      ('^' || v_prefix || '-' || v_year || '-([0-9]+)$'))::integer), 0) + 1
    into v_next
    from public.maintenance_coverages coverage
    where coverage.organization_id = p_organization_id
      and coverage.coverage_number ~ ('^' || v_prefix || '-' || v_year || '-[0-9]+$');
  else
    select coalesce(max(substring(plan.plan_number from
      ('^' || v_prefix || '-' || v_year || '-([0-9]+)$'))::integer), 0) + 1
    into v_next
    from public.maintenance_plans plan
    where plan.organization_id = p_organization_id
      and plan.plan_number ~ ('^' || v_prefix || '-' || v_year || '-[0-9]+$');
  end if;
  return v_prefix || '-' || v_year || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end;
$$;
