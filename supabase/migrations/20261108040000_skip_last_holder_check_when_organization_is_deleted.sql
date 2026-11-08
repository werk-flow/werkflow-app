-- Deleting an organization cascades to its members. The last-holder trigger
-- still checked each cascaded member removal, so an organization with a
-- selected responsibility group could not be deleted: the removal of the
-- group's last holder raised last_responsibility_holder and rolled the whole
-- deletion back.
--
-- A member whose organization row is gone goes with its organization, and so
-- does every responsibility group, so no group is left without a holder. The
-- trigger now returns early there, as the role-default refresh does since
-- 20260805212958_guard_responsibility_snapshot_on_org_delete.sql. Removing
-- the last holder of a selected group from a live organization still raises
-- last_responsibility_holder.
--
-- The signature, the check for a live organization, the lock and the grants
-- stay as in
-- 20261108010000_serialize_responsibility_holder_changes_per_organization.sql.

create or replace function app_private.protect_last_selected_responsibility_holder()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  removed_employee_record_id uuid;
  stranded_responsibility public.organization_responsibility;
begin
  if tg_op = 'UPDATE'
     and new.user_id is not distinct from old.user_id
     and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;

  select er.id into removed_employee_record_id
  from public.employee_records er
  where er.organization_id = old.organization_id and er.user_id = old.user_id;

  if removed_employee_record_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if not exists (
    select 1 from public.organizations organization
    where organization.id = old.organization_id
  ) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(old.organization_id::text || ':responsibility-holders', 0)
  );

  with latest as (
    select distinct on (c.responsibility) c.id, c.responsibility, c.mode
    from public.organization_responsibility_configurations c
    where c.organization_id = old.organization_id and c.effective_from <= clock_timestamp()
    order by c.responsibility, c.effective_from desc, c.created_at desc, c.id desc
  )
  select l.responsibility into stranded_responsibility
  from latest l
  where l.mode = 'selected'
    and exists (
      select 1 from public.organization_responsibility_assignments own_assignment
      where own_assignment.configuration_id = l.id
        and own_assignment.employee_record_id = removed_employee_record_id
    )
    and not exists (
      select 1
      from public.organization_responsibility_assignments other_assignment
      join public.employee_records other_record
        on other_record.id = other_assignment.employee_record_id
      join public.organization_members other_member
        on other_member.organization_id = other_record.organization_id
       and other_member.user_id = other_record.user_id
      where other_assignment.configuration_id = l.id
        and other_assignment.employee_record_id <> removed_employee_record_id
        and other_record.exit_date is null
    )
  limit 1;

  if stranded_responsibility is not null then
    raise exception 'last_responsibility_holder:%', stranded_responsibility;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
