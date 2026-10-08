-- Drop public functions that no code calls: neither the current build, nor
-- the deployed production build (origin/main), nor another database function,
-- policy, trigger or view. Each one is executable surface without a caller,
-- and five of them run as SECURITY DEFINER. lib/security/retired-functions.test.ts
-- keeps the public functions equal to the functions the code calls.
-- renew_employee_capability stays: the deployed production build still calls
-- it (migration rule, item 8).

-- @destructive: no caller in either build and no SQL caller; personnel documents are classified by other RPCs.
drop function public.classify_personnel_document(
  uuid, uuid, uuid, uuid, bigint, text,
  public.personnel_document_access_class, public.personnel_document_evidence_state,
  date, uuid, text
);

-- @destructive: baseline helper with no caller in either build and no SQL caller.
drop function public.get_org_clients(uuid);

-- @destructive: early RLS helper; no policy, function or build references it.
drop function public.get_user_admin_org_ids(uuid);

-- @destructive: early RLS helper; no policy, function or build references it.
drop function public.is_member_of_org(uuid, uuid);

-- @destructive: no caller in either build; the current build calls replace_project_capability_requirements_checked.
drop function public.replace_project_capability_requirements(uuid, uuid, uuid[], boolean[], uuid);

-- @destructive: no caller in either build and no SQL caller.
drop function public.update_maintenance_coverage(uuid, uuid, bigint, jsonb, text, uuid, uuid);

-- @destructive: no caller in either build and no SQL caller.
drop function public.update_planning_dispatch_instruction(uuid, uuid, uuid, integer, text, uuid[]);
