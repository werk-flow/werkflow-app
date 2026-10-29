-- Both the released Aufgaben list and Arbeitsnachweis detail reader use the
-- service role. Defect content no longer needs a client compatibility grant.
-- @destructive: after release 3fbe837f: all defect-detail readers use the service role
revoke select on table public.work_artifact_defect_details from authenticated;

-- @destructive: after release 3fbe837f: no client reads defect details; service_role bypasses RLS
drop policy "Authorized users can view work artifact defect details"
  on public.work_artifact_defect_details;

-- @destructive: after release 3fbe837f: the removed defect-detail policy was this helper's only caller
drop function app_private.can_access_work_artifact_revision(uuid, uuid);
