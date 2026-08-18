-- Baseline repair migration (part 3): org_role enum recreation.
--
-- The recorded history creates org_role as ('admin', 'employee', 'accountant')
-- and later appends 'manager' and 'secretary'. Prod's actual enum is exactly
-- ('admin', 'buero', 'employee') — the consolidation to the buero role model
-- happened outside the recorded migration history. Recorded migrations from
-- 20260426211533 onward reference 'buero'::org_role, so the recreation is
-- materialized here, directly before that point.
--
-- Postgres cannot remove enum values, so the type is recreated and every
-- dependent (two columns with defaults, two functions with org_role in their
-- signatures, three policies casting org_role values) is dropped and
-- recreated. Old values map: manager/secretary/accountant -> buero.
-- Guarded: a no-op where org_role already contains 'buero' (prod).

do $repair$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'org_role' and e.enumlabel = 'buero'
  ) then
    return;
  end if;

  -- 1) Drop dependents
  drop policy if exists "Admins and managers can view change requests" on public.entry_change_requests;
  drop policy if exists "organization_settings_update_for_admins" on public.organization_settings;
  drop policy if exists "Users can view permitted time entries" on public.time_entries;
  drop function if exists public.get_org_members(uuid);
  drop function if exists public.get_invite_by_code(text);
  alter table public.organization_members alter column role drop default;
  alter table public.organization_invites alter column invited_role drop default;

  -- 2) Recreate the type and convert the columns
  alter type public.org_role rename to org_role_old;
  create type public.org_role as enum ('admin', 'buero', 'employee');

  alter table public.organization_members
    alter column role type public.org_role
    using (case role::text
             when 'manager' then 'buero'
             when 'secretary' then 'buero'
             when 'accountant' then 'buero'
             else role::text
           end)::public.org_role;
  alter table public.organization_invites
    alter column invited_role type public.org_role
    using (case invited_role::text
             when 'manager' then 'buero'
             when 'secretary' then 'buero'
             when 'accountant' then 'buero'
             else invited_role::text
           end)::public.org_role;

  drop type public.org_role_old;

  alter table public.organization_members alter column role set default 'employee';
  alter table public.organization_invites alter column invited_role set default 'employee';

  -- 3) Recreate the policies with the new role set (later recorded migrations
  -- reshape the USING clauses again)
  create policy "Admins and managers can view change requests"
    on public.entry_change_requests
    for select
    using (
      exists (
        select 1
        from organization_members
        where organization_members.organization_id = entry_change_requests.organization_id
          and organization_members.user_id = auth.uid()
          and organization_members.role in ('admin', 'buero')
      )
    );

  create policy "organization_settings_update_for_admins" on public.organization_settings
    for update to authenticated
    using (exists (
      select 1 from public.organization_members
      where organization_members.organization_id = organization_settings.organization_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role = 'admin'::org_role
    ))
    with check (exists (
      select 1 from public.organization_members
      where organization_members.organization_id = organization_settings.organization_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role = 'admin'::org_role
    ));

  create policy "Users can view permitted time entries"
    on public.time_entries for select
    using (
      organization_id in (select get_user_org_ids(auth.uid()))
      and (
        user_id = auth.uid()
        or exists (
          select 1 from organization_members om
          where om.organization_id = time_entries.organization_id
            and om.user_id = auth.uid()
            and om.role = 'admin'
        )
        or exists (
          select 1 from organization_members om_caller
          join organization_members om_target on om_target.user_id = time_entries.user_id
            and om_target.organization_id = time_entries.organization_id
          where om_caller.organization_id = time_entries.organization_id
            and om_caller.user_id = auth.uid()
            and om_caller.role = 'buero'
            and om_target.role in ('employee')
        )
      )
    );

  -- 4) Recreate the functions (signatures unchanged; role hierarchy mapped)
  create function public.get_org_members(p_org_id uuid)
  returns table (
    user_id uuid,
    first_name text,
    last_name text,
    email text,
    role org_role,
    joined_at timestamptz
  )
  language plpgsql
  security definer
  as $fn$
  begin
    if not exists (
      select 1 from public.organization_members om
      where om.user_id = auth.uid() and om.organization_id = p_org_id
    ) then
      raise exception 'not_authorized';
    end if;

    return query
      select m.user_id,
             coalesce(p.first_name, '')::text,
             coalesce(p.last_name, '')::text,
             u.email::text,
             m.role,
             m.joined_at
      from public.organization_members m
      left join public.profiles p on p.id = m.user_id
      join auth.users u on u.id = m.user_id
      where m.organization_id = p_org_id
      order by
        case m.role
          when 'admin' then 1
          when 'buero' then 2
          when 'employee' then 3
          else 4
        end,
        coalesce(p.last_name, '') asc,
        coalesce(p.first_name, '') asc;
  end;
  $fn$;

  create function public.get_invite_by_code(p_invite_code text)
  returns table (
    id uuid,
    organization_id uuid,
    email text,
    status invite_status,
    expires_at timestamptz,
    org_name text,
    invited_role org_role
  )
  language plpgsql
  security definer
  as $fn$
  begin
    return query
      select
        i.id,
        i.organization_id,
        i.email,
        i.status,
        i.expires_at,
        o.name as org_name,
        i.invited_role
      from public.organization_invites i
      join public.organizations o on o.id = i.organization_id
      where i.invite_code = p_invite_code;
  end;
  $fn$;

  grant execute on function public.get_invite_by_code(text) to authenticated;
  grant execute on function public.get_invite_by_code(text) to anon;
end $repair$;
