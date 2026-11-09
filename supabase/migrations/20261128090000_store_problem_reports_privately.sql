-- Problem reports (werk-flow/werkflow-planning#331, part of #21). A member
-- reports a problem in the app; the report and its files stay in WerkFlow's
-- private EU storage. Only the reporter and WerkFlow support read a report;
-- no customer role reads another person's report, `admin` included. The
-- tables are server-only: RLS without a policy and grants to service_role
-- only, so every read goes through an authorized server action
-- (lib/problem-reports/).
--
-- Deletion periods (owner's answer on #21, 2026-11-09): the originals
-- (description, context, screenshot, attachments) go 90 days after the report
-- closes, at the latest 12 months after it was sent. The scrubbed copy goes
-- 24 months after the report closes, and the report with it. A daily run
-- (app/api/problem-report-retention/route.ts) applies both, one
-- apply_problem_report_retention call per report.
--
-- Prevention: Tier 1 (the deletion guard, the append-only history trigger,
-- the file-row deletion that queues its object), Tier 2
-- supabase/tests/problem_reports.sql.

create table public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- A deleted account takes its reports along: they are its personal data.
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  -- Equals the reporter, unless support filed the report for a caller.
  filed_by_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'eingegangen'
    check (status in ('eingegangen', 'in_bearbeitung', 'erledigt', 'abgelehnt')),
  bucket text check (bucket in ('blocker', 'fehler', 'unklarheit', 'wunsch')),
  closed_at timestamptz,
  -- Support's answer, which the reporter reads.
  response text check (char_length(response) between 1 and 4000),
  -- The originals: null once the retention run deleted them.
  description text check (char_length(description) between 1 and 5000),
  context jsonb check (jsonb_typeof(context) = 'object'),
  originals_deleted_at timestamptz,
  -- The scrubbed copy: empty until the scrubber wrote it, and never written
  -- when the text cannot be scrubbed.
  scrubbed_description text,
  scrub_state text not null default 'ausstehend'
    check (scrub_state in ('ausstehend', 'bereinigt', 'nicht_bereinigbar')),
  unique (id, organization_id),
  constraint problem_reports_closed_consistency
    check ((status in ('erledigt', 'abgelehnt')) = (closed_at is not null)),
  constraint problem_reports_originals_consistency check (
    case when originals_deleted_at is null
      then description is not null and context is not null
      else description is null and context is null
    end
  ),
  constraint problem_reports_scrub_consistency
    check ((scrub_state = 'bereinigt') = (scrubbed_description is not null))
);

create index problem_reports_reporter_idx
  on public.problem_reports (organization_id, reporter_id, created_at desc);

create table public.problem_report_files (
  id uuid primary key,
  organization_id uuid not null,
  report_id uuid not null,
  kind text not null check (kind in ('screenshot', 'anhang')),
  -- The name ends in `storage_path`, so the purge claim sees the column.
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  foreign key (report_id, organization_id)
    references public.problem_reports (id, organization_id) on delete cascade,
  constraint problem_report_files_path_in_report check (
    starts_with(storage_path, organization_id::text || '/problem-reports/' || report_id::text || '/')
  )
);

create unique index problem_report_files_one_screenshot
  on public.problem_report_files (report_id) where kind = 'screenshot';

-- The history of a report: status, bucket, assignee and response changes, and
-- every opening of an original by support. Append-only.
create table public.problem_report_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_id uuid not null,
  event_type text not null check (event_type in (
    'status_changed', 'bucket_changed', 'assignee_changed', 'response_changed', 'original_opened'
  )),
  actor_id uuid not null references public.profiles (id),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (report_id, organization_id)
    references public.problem_reports (id, organization_id) on delete cascade
);

create index problem_report_events_report_idx on public.problem_report_events (report_id, created_at);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.problem_reports enable row level security;
alter table public.problem_report_files enable row level security;
alter table public.problem_report_events enable row level security;
revoke all on table public.problem_reports from public, anon, authenticated, service_role;
revoke all on table public.problem_report_files from public, anon, authenticated, service_role;
revoke all on table public.problem_report_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.problem_reports to service_role;
grant select, insert, delete on table public.problem_report_files to service_role;
grant select, insert on table public.problem_report_events to service_role;

-- A report leaves only through the retention run or a cascade (its
-- organization or its reporter's account), and its originals change only
-- there. Who filed and sent it never changes.
create function app_private.guard_problem_report_write()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_retention constant boolean :=
    current_setting('app.problem_report_retention', true) is not distinct from 'on';
begin
  if tg_op = 'DELETE' then
    if v_retention or pg_trigger_depth() > 1 then return old; end if;
    raise exception 'problem_report_deletion_forbidden';
  end if;
  if new.organization_id <> old.organization_id or new.reporter_id <> old.reporter_id
    or new.created_at <> old.created_at
    or (new.filed_by_id is distinct from old.filed_by_id and pg_trigger_depth() = 1)
  then raise exception 'problem_report_identity_immutable'; end if;
  if not v_retention and (
    new.description is distinct from old.description or new.context is distinct from old.context
    or new.originals_deleted_at is distinct from old.originals_deleted_at
  ) then raise exception 'problem_report_originals_immutable'; end if;
  return new;
end;
$$;

create trigger problem_reports_guard
  before update or delete on public.problem_reports
  for each row execute function app_private.guard_problem_report_write();

create function app_private.guard_problem_report_history()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- The cascade of a report's deletion, which the report guard admits.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'problem_report_history_append_only';
end;
$$;

create trigger problem_report_events_append_only
  before update or delete on public.problem_report_events
  for each row execute function app_private.guard_problem_report_history();

-- Every removed file row queues its object for the purge in the same
-- transaction, whichever path removed it: the retention run, an organization
-- deletion or an account deletion. Definer rights, because an account
-- deletion's cascade runs as the Auth role, which holds no grant on the queue.
create function app_private.queue_removed_problem_report_files()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_organization record;
begin
  for v_organization in
    select removed.organization_id, array_agg(removed.storage_path) as paths
    from removed_files removed group by removed.organization_id
  loop
    perform public.queue_storage_purge(v_organization.organization_id, v_organization.paths);
  end loop;
  return null;
end;
$$;

revoke all on function app_private.guard_problem_report_write() from public, anon, authenticated;
revoke all on function app_private.guard_problem_report_history() from public, anon, authenticated;
revoke all on function app_private.queue_removed_problem_report_files() from public, anon, authenticated;

create trigger problem_report_files_queue_purge
  after delete on public.problem_report_files
  referencing old table as removed_files
  for each statement execute function app_private.queue_removed_problem_report_files();

-- What the retention run does with a report now: 'report' when the scrubbed
-- copy is due (24 months after closing), 'originals' when only the originals
-- are (90 days after closing, at the latest 12 months after sending), else null.
create function app_private.problem_report_retention_step(
  p_created_at timestamptz,
  p_closed_at timestamptz,
  p_originals_deleted_at timestamptz
)
returns text
language sql
stable
security invoker
set search_path to ''
as $$
  select case
    when p_closed_at is not null and p_closed_at + interval '24 months' <= now() then 'report'
    when p_originals_deleted_at is null and (
      p_created_at + interval '12 months' <= now()
      or (p_closed_at is not null and p_closed_at + interval '90 days' <= now())
    ) then 'originals'
  end;
$$;

-- One page of due reports after p_after, in id order, so a report whose
-- deletion failed never stops the run from reaching the next ones.
create function public.list_problem_reports_due_for_retention(p_limit integer, p_after uuid default null)
returns setof uuid
language sql
stable
security invoker
set search_path to ''
as $$
  select report.id from public.problem_reports report
  where (p_after is null or report.id > p_after)
    and app_private.problem_report_retention_step(
      report.created_at, report.closed_at, report.originals_deleted_at
    ) is not null
  order by report.id
  limit greatest(p_limit, 0);
$$;

-- Applies the due step to one report and names it: 'originals_deleted',
-- 'report_deleted' or 'not_due'. The originals step removes the file rows,
-- whose objects their trigger queues, and empties description and context;
-- the scrubbed copy, status and history stay. The report step deletes the
-- report with its files and history.
create function public.apply_problem_report_retention(p_report_id uuid)
returns text
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_report public.problem_reports%rowtype;
  v_step text;
begin
  select * into v_report from public.problem_reports report where report.id = p_report_id for update;
  if not found then return 'not_due'; end if;
  v_step := app_private.problem_report_retention_step(
    v_report.created_at, v_report.closed_at, v_report.originals_deleted_at
  );
  if v_step is null then return 'not_due'; end if;

  perform pg_catalog.set_config('app.problem_report_retention', 'on', true);
  if v_step = 'report' then
    delete from public.problem_reports report where report.id = p_report_id;
  else
    delete from public.problem_report_files file where file.report_id = p_report_id;
    update public.problem_reports report
    set description = null, context = null, originals_deleted_at = now()
    where report.id = p_report_id;
  end if;
  perform pg_catalog.set_config('app.problem_report_retention', '', true);
  return case v_step when 'report' then 'report_deleted' else 'originals_deleted' end;
end;
$$;

-- Registers one finalized upload of a report's own filer, while the report
-- keeps its originals: at most one screenshot, and at most p_max_attachments
-- attachments. The report row lock orders concurrent finalizes.
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

revoke all on function app_private.problem_report_retention_step(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.list_problem_reports_due_for_retention(integer, uuid) from public, anon, authenticated;
revoke all on function public.apply_problem_report_retention(uuid) from public, anon, authenticated;
revoke all on function public.register_problem_report_file(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, integer
) from public, anon, authenticated;
grant execute on function app_private.problem_report_retention_step(timestamptz, timestamptz, timestamptz)
  to service_role;
grant execute on function public.list_problem_reports_due_for_retention(integer, uuid) to service_role;
grant execute on function public.apply_problem_report_retention(uuid) to service_role;
grant execute on function public.register_problem_report_file(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, integer
) to service_role;
