-- Baseline repair migration (part 4): reconcile remaining unrecorded drift.
--
-- Closes the last gaps between the recorded migration history and prod's
-- actual schema, found by a full object-level comparison after replaying the
-- history into the dev project:
--   1. Six indexes that recorded migrations create were later dropped on prod
--      outside the recorded history (performance cleanup).
--   2. The invites view policy's role list was widened to PUBLIC outside the
--      recorded history.
--   3. get_user_admin_or_manager_org_ids was updated to the buero role model
--      outside the recorded history (its recorded form references the removed
--      'manager' enum value and would error at call time).
--   4. generate_project_number: byte-exact prod body (whitespace) so schema
--      comparisons converge.
-- Fully idempotent — a no-op on prod, where this state already exists.

-- 1) Indexes dropped on prod outside the recorded history
drop index if exists public.idx_entry_change_requests_entry;
drop index if exists public.idx_entry_change_requests_org;
drop index if exists public.idx_entry_change_requests_status;
drop index if exists public.idx_invites_email;
drop index if exists public.idx_organizations_admin_id;
drop index if exists public.job_instruction_items_org_job_idx;

-- 2) Policy role list
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'organization_invites'
             and policyname = 'Admins and managers can view org invites') then
    alter policy "Admins and managers can view org invites"
      on public.organization_invites to public;
  end if;
end $$;

-- 3) + 4) Current prod function bodies
CREATE OR REPLACE FUNCTION public.get_user_admin_or_manager_org_ids(p_user_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = p_user_id
    AND role IN ('admin', 'buero');
$function$;

CREATE OR REPLACE FUNCTION public.generate_project_number(p_org_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_year text;
  next_seq integer;
  result text;
BEGIN
  current_year := to_char(now(), 'YYYY');

  SELECT COALESCE(MAX(
    CASE
      WHEN project_number ~ ('^PRJ-' || current_year || '-[0-9]+$')
      THEN CAST(substring(project_number from '[0-9]+$') AS integer)
      ELSE 0
    END
  ), 0) + 1
  INTO next_seq
  FROM projects
  WHERE organization_id = p_org_id;

  result := 'PRJ-' || current_year || '-' || lpad(next_seq::text, 3, '0');
  RETURN result;
END;
$function$;
