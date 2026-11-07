-- A signed-in member reads three tables through the Data API without the
-- columns the server hides from field workers: the billing of a material line,
-- the readiness snapshot of a dispatch revision and the organization's period
-- totals of a close version. Row policies stay as they are; a column grant
-- removes the columns for every row a member may read. The server reads these
-- columns with the service role, which keeps its table grant.
--
-- job_material_lines is in the supabase_realtime publication. Realtime checks
-- each subscriber's column privileges: a change reaches the subscriber while
-- the primary key is selectable and carries only selectable columns. id,
-- organization_id and updated_at stay selectable, so the event, its
-- organization filter and its transaction stamp keep working.

-- @destructive: after release e713fa962f70b3ce7b8db3f4e6c4c6aa15f2b03a: that release reads job_material_lines only with the service role, and its live views use a material line event only as a refresh signal
revoke select on table public.job_material_lines from authenticated;
grant select (
  id, organization_id, job_id, project_id, item_id, preferred_location_id, planned_quantity, taken_quantity,
  returned_quantity, is_unplanned, status, notes, created_by, created_at, updated_at,
  work_template_application_id, source_work_template_material_line_id
) on table public.job_material_lines to authenticated;

-- @destructive: after release e713fa962f70b3ce7b8db3f4e6c4c6aa15f2b03a: that release reads planning_dispatch_revisions only with the service role and does not subscribe to it
revoke select on table public.planning_dispatch_revisions from authenticated;
grant select (
  id, organization_id, dispatch_id, revision_number, change_kind, occurrence_id, job_id, planned_start_at,
  planned_end_at, planned_start_date, planned_end_date_exclusive, location_text, site_id, dispatch_note,
  material_fingerprint, readiness_fingerprint, created_by, created_at
) on table public.planning_dispatch_revisions to authenticated;

-- @destructive: after release e713fa962f70b3ce7b8db3f4e6c4c6aa15f2b03a: that release reads time_period_close_versions only with the service role and does not subscribe to it
revoke select on table public.time_period_close_versions from authenticated;
grant select (
  id, organization_id, period_id, calculation_id, version, supersedes_close_version_id, source_fingerprint,
  closed_by, closed_at
) on table public.time_period_close_versions to authenticated;
