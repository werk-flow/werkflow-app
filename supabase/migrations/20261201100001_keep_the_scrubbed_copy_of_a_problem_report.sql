-- The scrubbed copy of a problem report (werk-flow/werkflow-planning#332,
-- part of #21). The server scrubs a stored report's description and context
-- and writes both with the scrub state in one call. A report that cannot be
-- scrubbed has no copy and the state `nicht_bereinigbar`; a later scrub may
-- still succeed. A written copy never changes.
--
-- Prevention: Tier 1 (the consistency rule, the write function),
-- Tier 2 supabase/tests/problem_reports.sql.

alter table public.problem_reports add column scrubbed_context jsonb;

-- @destructive: after release c9646653: that build and every build before this one never write the state `bereinigt`, so their rows keep both parts of the copy empty
alter table public.problem_reports
  add constraint problem_reports_scrubbed_context_consistency check (
    (scrub_state = 'bereinigt') = (scrubbed_context is not null)
    and (scrubbed_context is null or jsonb_typeof(scrubbed_context) = 'object')
  );

-- Writes the outcome of one scrub and returns the state the report has then.
-- Both parts of the copy make it `bereinigt`; no copy makes it
-- `nicht_bereinigbar`. A report that already has its copy keeps it, so a
-- failed run beside a successful one never removes the copy. The server
-- resolved the organization; a report of another organization reads as
-- `report_not_found`.
create function public.record_problem_report_scrub(
  p_organization_id uuid,
  p_report_id uuid,
  p_scrubbed_description text,
  p_scrubbed_context jsonb
)
returns text
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_state text;
begin
  if (p_scrubbed_description is null) <> (p_scrubbed_context is null) then
    raise exception 'scrubbed_copy_incomplete';
  end if;
  update public.problem_reports report
  set scrubbed_description = p_scrubbed_description,
      scrubbed_context = p_scrubbed_context,
      scrub_state = case when p_scrubbed_description is null then 'nicht_bereinigbar' else 'bereinigt' end
  where report.id = p_report_id and report.organization_id = p_organization_id
    and report.scrub_state <> 'bereinigt';
  select report.scrub_state into v_state from public.problem_reports report
  where report.id = p_report_id and report.organization_id = p_organization_id;
  if not found then raise exception 'report_not_found'; end if;
  return v_state;
end;
$$;

revoke all on function public.record_problem_report_scrub(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_problem_report_scrub(uuid, uuid, text, jsonb) to service_role;
