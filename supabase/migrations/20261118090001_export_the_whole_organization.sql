-- Admin exports the whole organization (werk-flow/werkflow-planning#287).
-- An export is one data part (every record as CSV, the document manifest)
-- and file parts that hold every original file: each document's current
-- file and each earlier version. The server plans the file parts once; the
-- start refuses a plan that misses, repeats or adds a file, so every file
-- lands in exactly one part. Each part's build starts with one call that
-- claims it and ends in one call, complete or fail; a failed part builds
-- again alone.
--
-- A built archive stays downloadable for seven days (owner's answer on
-- werk-flow/werkflow-planning#287). Each part's archive path is fixed at the
-- start. The claim queues it in storage_purge_queue, due seven days after the
-- build started, before the build stores anything, so every stored archive
-- has its deletion date, also one whose completion got lost or whose build
-- failed. Completion keeps that entry and makes the part downloadable until
-- it falls due. An archive needs no backup protection, so it gets no extra
-- day, and the organization's deletion makes it due instead of eight days
-- later: at once, or when the builds that may still store it have ended.
--
-- A build stores its archive after its claim commits, so the claim also
-- records in the entry when every build of that path has certainly ended:
-- fifteen minutes after the latest claim, three times the page's
-- maxDuration of 300 seconds (app/(app)/einstellungen/datenexport/page.tsx).
-- Until then the entry never falls due through the organization's deletion,
-- and the purge neither claims, releases nor completes it, so an archive
-- stored late is still queued and due. All builds of a part share its path
-- and its one entry; the conditional write keeps the archive stored first.
-- No column here ends in
-- `storage_path`, because claim_storage_purge keeps any queued object such a
-- column references: a planned file must not keep a deleted document's
-- bytes, and an archive must not keep itself.
--
-- Only an Admin of the organization starts, builds or downloads an export;
-- each function checks it again. Every start, part result and download writes
-- an event to an append-only ledger. A start removes the file plans of the
-- organization's exports whose archives are all past their seven days; the
-- exports, their parts and the ledger stay.
--
-- Prevention: Tier 1 (the plan check, the unique file and name per export,
-- the ledger guard, the write window in the queue), Tier 2
-- supabase/tests/organization_export.sql.

-- When the last writer that may store the entry's object has certainly
-- ended; null when nothing writes it any more. Until then the purge leaves
-- the entry alone.
alter table public.storage_purge_queue add column writes_end_at timestamptz;

create table public.organization_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- No foreign key: the export's history outlives the account that started it.
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  part_count integer not null check (part_count >= 1),
  file_count integer not null check (file_count >= 0),
  file_bytes bigint not null check (file_bytes >= 0),
  updated_at timestamptz not null default now()
);
create unique index organization_exports_replident_idx on public.organization_exports (id, organization_id);
create index organization_exports_organization_idx on public.organization_exports (organization_id, requested_at desc);
-- Every row version carries its transaction's time (lib/realtime/tables.ts, TRANSACTION_STAMPED_TABLES).
create trigger organization_exports_updated_at before update on public.organization_exports
  for each row execute function public.update_updated_at_column();

create table public.organization_export_parts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_id uuid not null,
  part_number integer not null check (part_number >= 1),
  kind text not null check (kind in ('data', 'files')),
  state text not null default 'pending' check (state in ('pending', 'ready', 'failed')),
  file_count integer not null default 0 check (file_count >= 0),
  file_bytes bigint not null default 0 check (file_bytes >= 0),
  archive_path text not null,
  archive_bytes bigint check (archive_bytes >= 0),
  -- When the latest build claimed the part; its archive is due for the purge seven days later.
  build_started_at timestamptz,
  built_at timestamptz,
  expires_at timestamptz,
  failure_reason text check (failure_reason ~ '^[a-z][a-z0-9_:]*$'),
  constraint organization_export_parts_export_fkey foreign key (export_id, organization_id)
    references public.organization_exports (id, organization_id) on delete cascade,
  constraint organization_export_parts_number_unique unique (export_id, part_number),
  constraint organization_export_parts_id_org_unique unique (id, organization_id),
  constraint organization_export_parts_data_first check ((kind = 'data') = (part_number = 1)),
  constraint organization_export_parts_archive_in_organization
    check (starts_with(archive_path, organization_id::text || '/')),
  constraint organization_export_parts_state_shape check (
    (state = 'ready') = (archive_bytes is not null and built_at is not null and expires_at is not null)
    and (state <> 'ready' or build_started_at is not null)
    and (state = 'failed') = (failure_reason is not null)
  )
);

create table public.organization_export_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_id uuid not null,
  part_id uuid not null,
  -- No foreign key: the plan keeps naming a document deleted after the start.
  document_id uuid not null,
  -- Null for the document's current file, else the earlier version's number.
  version_number integer check (version_number >= 1),
  source_path text not null check (starts_with(source_path, organization_id::text || '/')),
  archive_name text not null check (archive_name ~ '^Dateien/' and archive_name !~ '(^|/)\.{0,2}(/|$)'),
  file_bytes bigint not null check (file_bytes >= 0),
  constraint organization_export_files_export_fkey foreign key (export_id, organization_id)
    references public.organization_exports (id, organization_id) on delete cascade,
  constraint organization_export_files_part_fkey foreign key (part_id, organization_id)
    references public.organization_export_parts (id, organization_id) on delete cascade,
  constraint organization_export_files_once unique (export_id, source_path)
);
-- Archive programs on Windows and macOS treat names that differ only in case as one file.
create unique index organization_export_files_name_once
  on public.organization_export_files (export_id, lower(archive_name));
create index organization_export_files_part_idx on public.organization_export_files (part_id);

create table public.organization_export_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_id uuid not null,
  part_id uuid,
  event_type text not null check (event_type in ('started', 'part_ready', 'part_failed', 'downloaded')),
  -- No foreign key: the ledger outlives the account that acted.
  actor_id uuid not null,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint organization_export_events_export_fkey foreign key (export_id, organization_id)
    references public.organization_exports (id, organization_id) on delete cascade
);
create index organization_export_events_export_idx on public.organization_export_events (export_id, occurred_at);
create trigger guard_event_ledger_history before update or delete on public.organization_export_events
  for each row execute function app_private.guard_event_ledger_history();

-- The organizations a user is an Admin of, with effective access: the
-- Realtime and Data API read of organization_exports.
create function app_private.get_user_admin_org_ids(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select member.organization_id
  from public.organization_members member
  where member.user_id = p_user_id
    and member.role = 'admin'
    and app_private.p1_24_has_effective_access(member.organization_id, p_user_id);
$$;
revoke all on function app_private.get_user_admin_org_ids(uuid) from public, anon, authenticated;
grant execute on function app_private.get_user_admin_org_ids(uuid) to authenticated, service_role;

alter table public.organization_exports enable row level security;
alter table public.organization_export_parts enable row level security;
alter table public.organization_export_files enable row level security;
alter table public.organization_export_events enable row level security;

-- An Admin's session reads the export row only to hear of a change; the
-- server reads parts, files and events.
create policy organization_exports_admin_select on public.organization_exports for select to authenticated
  using (organization_id in (select app_private.get_user_admin_org_ids((select auth.uid()))));

revoke all on table public.organization_exports, public.organization_export_parts,
  public.organization_export_files, public.organization_export_events
  from public, anon, authenticated, service_role;
grant select on table public.organization_exports to authenticated;
grant select, insert, update on table public.organization_exports, public.organization_export_parts to service_role;
grant select, insert on table public.organization_export_files, public.organization_export_events to service_role;
-- The start removes the file plans of exports whose archives are past their seven days.
grant delete on table public.organization_export_files to service_role;

alter table public.organization_exports replica identity using index organization_exports_replident_idx;
alter publication supabase_realtime add table public.organization_exports;
create trigger emit_realtime_deletion after delete on public.organization_exports
  for each row execute function app_private.emit_realtime_deletion();

-- The plan as rows: one per named file, with the index of its file part.
create function app_private.organization_export_plan(p_file_parts jsonb)
returns table (part_index integer, source_path text, archive_name text)
language sql
immutable
set search_path to ''
as $$
  select part.ordinality::integer, file.value ->> 'sourcePath', file.value ->> 'archiveName'
  from jsonb_array_elements(p_file_parts) with ordinality as part(value, ordinality)
  cross join lateral jsonb_array_elements(part.value) as file(value);
$$;

-- Every original file of the organization: each document's current file and
-- each earlier version, once per storage key.
create function app_private.organization_export_sources(p_organization_id uuid)
returns table (source_path text, document_id uuid, version_number integer, file_bytes bigint)
language sql
stable
set search_path to ''
as $$
  select distinct on (source.source_path) source.source_path, source.document_id,
    source.version_number, source.file_bytes
  from (
    select document.storage_path as source_path, document.id as document_id,
      null::integer as version_number, document.size_bytes::bigint as file_bytes
    from public.documents document
    where document.organization_id = p_organization_id
    union all
    select version.storage_path, version.document_id, version.version_number, version.size_bytes::bigint
    from public.document_versions version
    where version.organization_id = p_organization_id
  ) source
  order by source.source_path, source.version_number nulls first;
$$;

-- Queues objects of one organization for deletion. A document file waits
-- eight days, and queued again keeps the later date, as in
-- 20261108210001_keep_deleted_file_bytes_past_the_backup_window.sql. An
-- export archive needs no backup protection: queued again, such as by the
-- organization's deletion, it is due once the builds that may still store it
-- have ended, at once if none may, and never later than before.
create or replace function public.queue_storage_purge(p_organization_id uuid, p_paths text[])
returns void
language sql
security invoker
set search_path to ''
as $$
  insert into public.storage_purge_queue as queued (organization_id, storage_path, purge_after)
  select distinct p_organization_id, path,
    case when starts_with(path, p_organization_id::text || '/datenexporte/') then now()
      else now() + interval '8 days' end
  from unnest(p_paths) as path
  where path is not null
  on conflict (storage_path) do update
    set purge_after = case
      when starts_with(excluded.storage_path, excluded.organization_id::text || '/datenexporte/')
        then least(queued.purge_after, greatest(excluded.purge_after, queued.writes_end_at))
      else greatest(queued.purge_after, excluded.purge_after)
    end;
$$;

-- As in 20261108210001_keep_deleted_file_bytes_past_the_backup_window.sql,
-- except that an entry whose writes have not ended is neither released nor
-- claimed: a build may still store its object.
create or replace function public.claim_storage_purge(p_limit integer)
returns table (id uuid, organization_id uuid, storage_path text)
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_column record;
begin
  for v_column in
    select relation.relname as table_name, attribute.attname as column_name
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind in ('r', 'p')
      and relation.relname <> 'storage_purge_queue'
      and attribute.attname like '%storage\_path'
      and attribute.attnum > 0 and not attribute.attisdropped
  loop
    execute format(
      'delete from public.storage_purge_queue queued where queued.purge_after <= now()
         and (queued.writes_end_at is null or queued.writes_end_at <= now())
         and exists (select 1 from public.%I referencing where referencing.%I = queued.storage_path)',
      v_column.table_name, v_column.column_name
    );
  end loop;

  return query
  with due as (
    select queued.id from public.storage_purge_queue queued
    where queued.purge_after <= now()
      and (queued.writes_end_at is null or queued.writes_end_at <= now())
      and (queued.last_attempt_at is null or queued.last_attempt_at <= now() - interval '1 hour')
    order by queued.purge_after, queued.id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.storage_purge_queue queued
  set attempts = queued.attempts + 1, last_attempt_at = now()
  from due
  where queued.id = due.id
  returning queued.id, queued.organization_id, queued.storage_path;
end;
$$;

-- Removes the entries whose objects the purge deleted, except one a build
-- claimed after the purge did: that build may store its object again, so
-- the entry stays for a later run.
create or replace function public.complete_storage_purge(p_ids uuid[])
returns void
language sql
security invoker
set search_path to ''
as $$
  delete from public.storage_purge_queue queued
  where queued.id = any(p_ids) and (queued.writes_end_at is null or queued.writes_end_at <= now());
$$;

-- Starts an export with the server's plan: one array of file parts, each a
-- non-empty array of { "sourcePath", "archiveName" }. The plan names each
-- original file of the organization exactly once and nothing else, and no
-- two files share a name, also not in another letter case; sizes and
-- document ids come from the rows. Returns the export id.
create function public.start_organization_export(
  p_actor_id uuid,
  p_organization_id uuid,
  p_file_parts jsonb
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_export_id uuid := gen_random_uuid();
  v_part_count integer;
  v_file_count integer;
  v_file_bytes bigint;
begin
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  if jsonb_typeof(p_file_parts) is distinct from 'array' or exists (
    select 1 from jsonb_array_elements(p_file_parts) part
    where jsonb_typeof(part) <> 'array' or jsonb_array_length(part) = 0
  ) or exists (
    select 1 from app_private.organization_export_plan(p_file_parts) plan
    where plan.source_path is null or plan.archive_name is null
  ) then
    raise exception 'export_plan_invalid';
  end if;
  if exists (
    select 1 from app_private.organization_export_plan(p_file_parts) plan
    group by plan.source_path having count(*) > 1
  ) then
    raise exception 'export_plan_repeats_file';
  end if;
  if exists (
    select 1 from app_private.organization_export_plan(p_file_parts) plan
    group by lower(plan.archive_name) having count(*) > 1
  ) then
    raise exception 'export_plan_repeats_name';
  end if;
  -- A file the plan misses, or a path that is no file of this organization:
  -- the documents changed since the server listed them, or the plan is wrong.
  if exists (
    select 1 from app_private.organization_export_sources(p_organization_id) source
    where not exists (
      select 1 from app_private.organization_export_plan(p_file_parts) plan
      where plan.source_path = source.source_path
    )
  ) or exists (
    select 1 from app_private.organization_export_plan(p_file_parts) plan
    where not exists (
      select 1 from app_private.organization_export_sources(p_organization_id) source
      where source.source_path = plan.source_path
    )
  ) then
    raise exception 'export_plan_stale';
  end if;

  v_part_count := jsonb_array_length(p_file_parts) + 1;

  -- The totals follow the file rows below: each statement reads the files
  -- anew, so totals read from the files here could differ from the rows
  -- when an upload or deletion commits in between.
  insert into public.organization_exports (id, organization_id, requested_by, part_count, file_count, file_bytes)
  values (v_export_id, p_organization_id, p_actor_id, v_part_count, 0, 0);
  insert into public.organization_export_parts (organization_id, export_id, part_number, kind, archive_path)
  select p_organization_id, v_export_id, part_number,
    case when part_number = 1 then 'data' else 'files' end,
    format('%s/datenexporte/%s/teil-%s.zip', p_organization_id, v_export_id, part_number)
  from generate_series(1, v_part_count) as part_number;
  -- One join of the plan with the files, not one per part: neither function
  -- inlines, so a join per part would read every file once per part.
  insert into public.organization_export_files (
    organization_id, export_id, part_id, document_id, version_number, source_path, archive_name, file_bytes
  )
  select p_organization_id, v_export_id, part.id, source.document_id, source.version_number,
    source.source_path, plan.archive_name, source.file_bytes
  from app_private.organization_export_plan(p_file_parts) plan
  join app_private.organization_export_sources(p_organization_id) source
    on source.source_path = plan.source_path
  join public.organization_export_parts part
    on part.export_id = v_export_id and part.part_number = plan.part_index + 1;
  update public.organization_export_parts part
  set file_count = totals.file_count, file_bytes = totals.file_bytes
  from (
    select file.part_id, count(*)::integer as file_count, sum(file.file_bytes)::bigint as file_bytes
    from public.organization_export_files file
    where file.export_id = v_export_id
    group by file.part_id
  ) totals
  where part.id = totals.part_id;
  update public.organization_exports export_row
  set file_count = totals.file_count, file_bytes = totals.file_bytes
  from (
    select count(*)::integer as file_count, coalesce(sum(file.file_bytes), 0)::bigint as file_bytes
    from public.organization_export_files file
    where file.export_id = v_export_id
  ) totals
  where export_row.id = v_export_id
  returning export_row.file_count, export_row.file_bytes into v_file_count, v_file_bytes;
  -- The plans of exports whose archives are all past their seven days: a
  -- part builds within seven days of the start and its archive is due seven
  -- days after its build began, so no build reads these rows any more.
  delete from public.organization_export_files file
  using public.organization_exports export_row
  where file.export_id = export_row.id
    and export_row.organization_id = p_organization_id
    and export_row.requested_at <= now() - interval '14 days';

  insert into public.organization_export_events (organization_id, export_id, event_type, actor_id, event_payload)
  values (p_organization_id, v_export_id, 'started', p_actor_id, jsonb_build_object(
    'partCount', v_part_count, 'fileCount', v_file_count, 'fileBytes', v_file_bytes
  ));
  return v_export_id;
end;
$$;

-- Claims a part for a build before the build stores anything: queues the
-- part's archive path for the purge seven days from now, the build's start,
-- in the same call, so an archive whose completion is never recorded is
-- deleted too. The entry also holds the end of the build's write window,
-- fifteen minutes from now. A later build of a part not yet ready moves both
-- to its own start, never back: the archive it records is the one stored
-- first (the build's conditional write), downloadable until the entry falls
-- due.
-- Refuses a ready part, and an export older than seven days. Returns what
-- the build needs: { exportId, kind, archivePath, partCount }.
create function public.claim_organization_export_part_build(
  p_actor_id uuid,
  p_organization_id uuid,
  p_part_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_part public.organization_export_parts;
  v_export public.organization_exports;
  v_started timestamptz;
begin
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_part from public.organization_export_parts part
  where part.id = p_part_id and part.organization_id = p_organization_id
  for update;
  if not found then raise exception 'export_part_not_found'; end if;
  if v_part.state = 'ready' then raise exception 'export_part_ready'; end if;
  -- now() is the transaction's start: a claim that waited for the part's
  -- lock keeps the later start of the claim committed before it, so the
  -- part's expiry and its archive's purge stay one date.
  v_started := greatest(now(), v_part.build_started_at);
  select * into v_export from public.organization_exports export_row
  where export_row.id = v_part.export_id and export_row.organization_id = p_organization_id;
  if v_export.requested_at <= now() - interval '7 days' then raise exception 'export_part_expired'; end if;

  update public.organization_export_parts part set build_started_at = v_started where part.id = p_part_id;
  insert into public.storage_purge_queue as queued (organization_id, storage_path, purge_after, writes_end_at)
  values (p_organization_id, v_part.archive_path, v_started + interval '7 days', v_started + interval '15 minutes')
  on conflict (storage_path) do update
    set purge_after = excluded.purge_after, writes_end_at = excluded.writes_end_at;
  return jsonb_build_object(
    'exportId', v_part.export_id,
    'kind', v_part.kind,
    'archivePath', v_part.archive_path,
    'partCount', v_export.part_count
  );
end;
$$;

-- Records a built archive at the part's fixed path: the part is ready until
-- the archive's purge entry, written by its build's claim, falls due seven
-- days after the build started. A ready part is refused, so a second build
-- of it changes nothing.
create function public.complete_organization_export_part(
  p_actor_id uuid,
  p_organization_id uuid,
  p_part_id uuid,
  p_archive_bytes bigint
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_part public.organization_export_parts;
begin
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_part from public.organization_export_parts part
  where part.id = p_part_id and part.organization_id = p_organization_id
  for update;
  if not found then raise exception 'export_part_not_found'; end if;
  if v_part.state = 'ready' then raise exception 'export_part_ready'; end if;
  if v_part.build_started_at is null then raise exception 'export_part_not_claimed'; end if;

  update public.organization_export_parts part
  set state = 'ready', failure_reason = null, archive_bytes = p_archive_bytes, built_at = now(),
    expires_at = v_part.build_started_at + interval '7 days'
  where part.id = p_part_id;
  update public.organization_exports export_row set updated_at = now() where export_row.id = v_part.export_id;
  insert into public.organization_export_events (
    organization_id, export_id, part_id, event_type, actor_id, event_payload
  ) values (
    p_organization_id, v_part.export_id, p_part_id, 'part_ready', p_actor_id,
    jsonb_build_object('partNumber', v_part.part_number, 'archiveBytes', p_archive_bytes,
      'fileCount', v_part.file_count)
  );
end;
$$;

-- Records a failed build with a stable reason code; the part builds again alone.
create function public.fail_organization_export_part(
  p_actor_id uuid,
  p_organization_id uuid,
  p_part_id uuid,
  p_failure_reason text
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_part public.organization_export_parts;
begin
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_part from public.organization_export_parts part
  where part.id = p_part_id and part.organization_id = p_organization_id
  for update;
  if not found then raise exception 'export_part_not_found'; end if;
  if v_part.state = 'ready' then raise exception 'export_part_ready'; end if;

  update public.organization_export_parts part
  set state = 'failed', failure_reason = p_failure_reason
  where part.id = p_part_id;
  update public.organization_exports export_row set updated_at = now() where export_row.id = v_part.export_id;
  insert into public.organization_export_events (
    organization_id, export_id, part_id, event_type, actor_id, event_payload
  ) values (
    p_organization_id, v_part.export_id, p_part_id, 'part_failed', p_actor_id,
    jsonb_build_object('partNumber', v_part.part_number, 'reason', p_failure_reason)
  );
end;
$$;

-- A part leaves only with its organization. Its archive, if a build claimed
-- it, is queued again like a listed object, so an archive stored after the
-- deletion's listing is due when its builds have ended, not seven days after
-- its claim. The part row's lock orders this after a claim in flight.
create function app_private.queue_deleted_export_part_archive()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if old.build_started_at is not null then
    perform public.queue_storage_purge(old.organization_id, array[old.archive_path]);
  end if;
  return null;
end;
$$;
revoke all on function app_private.queue_deleted_export_part_archive() from public, anon, authenticated;
create trigger queue_deleted_export_part_archive after delete on public.organization_export_parts
  for each row execute function app_private.queue_deleted_export_part_archive();

-- Records a download of a ready, unexpired part and returns what the server
-- signs: { archivePath, partNumber, partCount, requestedAt }.
create function public.record_organization_export_download(
  p_actor_id uuid,
  p_organization_id uuid,
  p_part_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_part public.organization_export_parts;
begin
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_part from public.organization_export_parts part
  where part.id = p_part_id and part.organization_id = p_organization_id;
  if not found then raise exception 'export_part_not_found'; end if;
  if v_part.state <> 'ready' then raise exception 'export_part_not_ready'; end if;
  if v_part.expires_at <= now() then raise exception 'export_part_expired'; end if;

  insert into public.organization_export_events (
    organization_id, export_id, part_id, event_type, actor_id, event_payload
  ) values (
    p_organization_id, v_part.export_id, p_part_id, 'downloaded', p_actor_id,
    jsonb_build_object('partNumber', v_part.part_number)
  );
  return jsonb_build_object(
    'archivePath', v_part.archive_path,
    'partNumber', v_part.part_number,
    'partCount', (select export_row.part_count from public.organization_exports export_row
      where export_row.id = v_part.export_id),
    'requestedAt', (select export_row.requested_at from public.organization_exports export_row
      where export_row.id = v_part.export_id)
  );
end;
$$;

-- One page of an organization's rows of one table, in primary-key order,
-- after the row whose key p_after carries (null for the first page), with
-- the table's columns in table order: { "columns": [...], "rows": [...] }.
-- A table without organization_id or without a primary key is refused.
create function public.read_organization_export_page(
  p_organization_id uuid,
  p_table text,
  p_after jsonb,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
  v_relation regclass := to_regclass(format('public.%I', p_table));
  v_keys text[];
  v_order text;
  v_page_order text;
  v_after text := '';
  v_rows jsonb;
begin
  if v_relation is null or not exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_relation and attribute.attname = 'organization_id' and not attribute.attisdropped
  ) then
    raise exception 'export_table_unknown';
  end if;
  select array_agg(attribute.attname::text order by key.ordinality) into v_keys
  from pg_catalog.pg_index index_row
  cross join lateral unnest(index_row.indkey) with ordinality as key(attnum, ordinality)
  join pg_catalog.pg_attribute attribute
    on attribute.attrelid = index_row.indrelid and attribute.attnum = key.attnum
  where index_row.indrelid = v_relation and index_row.indisprimary;
  if v_keys is null then raise exception 'export_table_without_key'; end if;

  select string_agg(format('source.%I', key_name), ', '), string_agg(format('page.%I', key_name), ', ')
  into v_order, v_page_order from unnest(v_keys) key_name;
  if p_after is not null then
    select format('and (%s) > (select %s from jsonb_populate_record(null::%s, $2) after_row)',
      v_order, string_agg(format('after_row.%I', key_name), ', '), v_relation)
    into v_after from unnest(v_keys) key_name;
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(page) order by %s), ''[]''::jsonb)
     from (select source.* from %s source where source.organization_id = $1 %s order by %s limit $3) page',
    v_page_order, v_relation, v_after, v_order
  ) into v_rows using p_organization_id, p_after, greatest(least(p_limit, 5000), 1);
  return jsonb_build_object(
    'columns', (
      select jsonb_agg(attribute.attname order by attribute.attnum)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_relation and attribute.attnum > 0 and not attribute.attisdropped
    ),
    'rows', v_rows
  );
end;
$$;

revoke all on function app_private.organization_export_plan(jsonb) from public, anon, authenticated;
revoke all on function app_private.organization_export_sources(uuid) from public, anon, authenticated;
revoke all on function public.start_organization_export(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_organization_export_part_build(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_organization_export_part(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.fail_organization_export_part(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_organization_export_download(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.read_organization_export_page(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function app_private.organization_export_plan(jsonb) to service_role;
grant execute on function app_private.organization_export_sources(uuid) to service_role;
grant execute on function public.start_organization_export(uuid, uuid, jsonb) to service_role;
grant execute on function public.claim_organization_export_part_build(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_organization_export_part(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.fail_organization_export_part(uuid, uuid, uuid, text) to service_role;
grant execute on function public.record_organization_export_download(uuid, uuid, uuid) to service_role;
grant execute on function public.read_organization_export_page(uuid, text, jsonb, integer) to service_role;
