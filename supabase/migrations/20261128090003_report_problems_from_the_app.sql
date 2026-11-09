-- Reporting a problem from the app (werk-flow/werkflow-planning#334, part of
-- #21). The reporter's receipt names a report by its number, never by its id:
-- each organization numbers its reports from 1, and a number never changes.
-- The screenshot and attachments register through one function call, which
-- repeats the report's checks under its row lock.
--
-- Prevention: Tier 1 (the numbering trigger, the registration checks),
-- Tier 2 supabase/tests/problem_reports.sql.

-- The trigger below always assigns the number; the default only lets an
-- insert leave it out.
alter table public.problem_reports add column number integer not null default 0;

-- No product path has sent a report yet; number any test rows by sending time.
update public.problem_reports report
set number = numbered.number
from (
  select id, row_number() over (partition by organization_id order by created_at, id)::integer as number
  from public.problem_reports
) numbered
where numbered.id = report.id;

-- @destructive: after release 34f34e62: that build has no report table and writes no report; every row present was numbered above
alter table public.problem_reports
  add constraint problem_reports_number_unique unique (organization_id, number);

-- A new report takes the next number of its organization. The transaction
-- lock on the organization serializes two reports sent at once. A number
-- never changes afterwards.
create function app_private.number_problem_report()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.number <> old.number then raise exception 'problem_report_identity_immutable'; end if;
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('problem_report_number:' || new.organization_id::text, 0)
  );
  select coalesce(max(report.number), 0) + 1 into new.number
  from public.problem_reports report
  where report.organization_id = new.organization_id;
  return new;
end;
$$;

revoke all on function app_private.number_problem_report() from public, anon, authenticated;

create trigger problem_reports_number
  before insert or update of number on public.problem_reports
  for each row execute function app_private.number_problem_report();

-- Registers one stored file of a report. Only the person who filed the
-- report adds files, and only while it keeps its originals: one screenshot,
-- and attachments up to the given limit. The server resolved actor and
-- organization; another person's report and a report of another
-- organization read alike as `report_not_found`.
create function public.register_problem_report_file(
  p_actor_id uuid,
  p_organization_id uuid,
  p_report_id uuid,
  p_file_id uuid,
  p_kind text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_max_attachments integer
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_report public.problem_reports%rowtype;
begin
  select * into v_report from public.problem_reports report
  where report.id = p_report_id and report.organization_id = p_organization_id
  for update;
  if not found or v_report.filed_by_id is distinct from p_actor_id then
    raise exception 'report_not_found';
  end if;
  if v_report.originals_deleted_at is not null then raise exception 'report_originals_deleted'; end if;
  if exists (select 1 from public.problem_report_files file where file.id = p_file_id) then
    raise exception 'already_finalized';
  end if;
  if p_kind = 'screenshot' and exists (
    select 1 from public.problem_report_files file
    where file.report_id = p_report_id and file.kind = 'screenshot'
  ) then raise exception 'screenshot_exists'; end if;
  if p_kind = 'anhang' and (
    select count(*) from public.problem_report_files file
    where file.report_id = p_report_id and file.kind = 'anhang'
  ) >= p_max_attachments then raise exception 'too_many_attachments'; end if;

  insert into public.problem_report_files (
    id, organization_id, report_id, kind, storage_path, file_name, mime_type, size_bytes
  ) values (
    p_file_id, p_organization_id, p_report_id, p_kind, p_storage_path, p_file_name, p_mime_type, p_size_bytes
  );
end;
$$;

revoke all on function public.register_problem_report_file(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, integer
) from public, anon, authenticated;
grant execute on function public.register_problem_report_file(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, integer
) to service_role;
