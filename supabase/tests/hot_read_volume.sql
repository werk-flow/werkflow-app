-- Hot reads touch rows in proportion to the work they show, never to the organization's history
-- (docs/technical/performance.md, "Database work of a hot read").
--
-- Two organizations hold the same current work: active jobs, open projects, one week of visits and
-- time, pending approvals. The large one then gains a year of closed history and ten times the
-- customers. Each hot read runs in its app call shape as service_role, the role of the admin client
-- the readers use. The transaction's own statistics counters (pg_stat_get_xact_*) give the rows a
-- read touched per table: heap rows sequential scans read plus index entries index scans returned.
-- - The history may add touched rows only to a read that history_reads below names.
-- - The small organization's reads touch the same rows before and after the large one gains its
--   history, so a read that loses its organization bound fails.
-- - enable_seqscan is off: a sequential scan means that no index serves the predicate.
-- The planner keeps the stack's statistics: an ANALYZE of this seed flipped the Aufträge plan
-- between runs on identical rows. Every run takes fresh ids, so no dead index entry of an earlier
-- rolled-back run shares a measured key range, and each read runs once before its measured run.
begin;
create temp table hot_ids as select gen_random_uuid() run, gen_random_uuid() owner,
  gen_random_uuid() large_org, gen_random_uuid() small_org, gen_random_uuid() large_worker, gen_random_uuid() small_worker;
grant select on hot_ids to service_role;
-- Organization 1 is the large one, organization 2 the small one; each has its own worker.
create function pg_temp.org(p_organization integer) returns uuid language sql stable as $$
  select case p_organization when 1 then large_org else small_org end from hot_ids $$;
create function pg_temp.worker(p_organization integer) returns uuid language sql stable as $$
  select case p_organization when 1 then large_worker else small_worker end from hot_ids $$;
-- A deterministic id per kind and number within this run.
create function pg_temp.id(p_kind text, p_organization integer, p_number integer) returns uuid language sql stable as $$
  select md5(run::text||p_kind||p_organization||'-'||p_number)::uuid from hot_ids $$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','hot-read-'||id||'@example.test','',now(),'{}',
  '{"first_name":"Hot","last_name":"Read"}',now(),now()
from hot_ids, unnest(array[owner, large_worker, small_worker]) id;
grant execute on all functions in schema pg_temp to service_role;
set local role service_role;
insert into public.organizations(id,name,admin_id,unique_code)
select pg_temp.org(o),'Hot read '||o,owner,upper(substr(md5(run::text||o),1,8)) from hot_ids, generate_series(1,2) o;
insert into public.organization_members(organization_id,user_id,role)
select pg_temp.org(o),pg_temp.worker(o),'employee' from generate_series(1,2) o;
reset role;

-- The current work exists in both organizations; the closed history (p_history) only in the large one.
create function pg_temp.seeds(p_organization integer, p_current boolean, p_history boolean) returns boolean
language sql immutable as $$ select case when p_history then p_organization = 1 and not p_current else p_current end $$;
create function pg_temp.seed(p_history boolean) returns void language sql as $$
  insert into public.clients(id,organization_id,name)
  select pg_temp.id('client',o,c),pg_temp.org(o),'Kunde '||c
  from generate_series(1,2) o, generate_series(1,1000) c where pg_temp.seeds(o, c<=100, p_history);
  -- Projects 1 and 2 are open; the history's projects were handed over.
  insert into public.projects(id,organization_id,name,project_number,created_by,execution_state_override)
  select pg_temp.id('project',o,p),pg_temp.org(o),'Projekt '||p,'HP'||o||'-'||p,owner,
    case when p>2 then 'handed_over'::public.work_execution_state end
  from hot_ids, generate_series(1,2) o, generate_series(1,100) p where pg_temp.seeds(o, p<=2, p_history);
  -- Jobs 1 to 200 belong to the first 20 projects, ten each; jobs above 1900 are active, the others finished.
  insert into public.jobs(id,organization_id,title,job_number,created_by,client_id,project_id,status,execution_state,created_at)
  select pg_temp.id('job',o,j),pg_temp.org(o),'Auftrag '||j,'HJ'||o||'-'||j,owner,pg_temp.id('client',o,j%100+1),
    case when j<=200 then pg_temp.id('project',o,(j-1)/10+1) end,
    case when j>1900 then 'nicht_bearbeitet'::public.job_status else 'fertig' end,
    case when j>1900 then 'not_started'::public.work_execution_state else 'handed_over' end,
    '2025-11-01T08:00:00Z'::timestamptz+j*interval '4 hours'
  from hot_ids, generate_series(1,2) o, generate_series(1,2000) j where pg_temp.seeds(o, j<=20 or j>1900, p_history);
  insert into public.job_assignments(organization_id,job_id,user_id,assigned_by)
  select pg_temp.org(o),pg_temp.id('job',o,j),pg_temp.worker(o),owner
  from hot_ids, generate_series(1,2) o, generate_series(10,2000,10) j where pg_temp.seeds(o, j<=20 or j>1900, p_history);
  insert into public.documents(organization_id,storage_path,original_file_name,display_name,size_bytes,uploaded_by)
  select pg_temp.org(o),pg_temp.org(o)||'/hot-read/'||d,'datei.pdf','Datei '||lpad(d::text,4,'0'),1,owner
  from hot_ids, generate_series(1,2) o, generate_series(1,1000) d where pg_temp.seeds(o, d<=50, p_history);
  -- A year of the worker's approved days from 2025-11-02 (days 337 to 343 are the measured week,
  -- 2026-10-05 to 2026-10-11), and four entries waiting for approval.
  insert into public.time_entries(organization_id,user_id,entry_type,timestamp,status,is_manual)
  select pg_temp.org(o),pg_temp.worker(o),kind,
    '2025-11-02T07:00:00Z'::timestamptz+d*interval '1 day'+case kind when 'clock_in' then interval '0' else interval '8 hours' end,'approved',true
  from generate_series(1,2) o, generate_series(0,364) d, unnest(array['clock_in','clock_out']) kind
  where extract(isodow from '2025-11-02'::date+d)<6 and pg_temp.seeds(o, d between 337 and 343, p_history);
  insert into public.time_entries(organization_id,user_id,entry_type,timestamp,status,is_manual)
  select pg_temp.org(o),pg_temp.worker(o),kind,
    '2026-11-01T07:00:00Z'::timestamptz+d*interval '1 day'+case kind when 'clock_in' then interval '0' else interval '4 hours' end,'pending',true
  from generate_series(1,2) o, generate_series(0,1) d, unnest(array['clock_in','clock_out']) kind where not p_history;
  -- Four visits a day over the same year.
  insert into public.planning_occurrences(organization_id,entry_kind,time_kind,internal_type,title,start_at,end_at)
  select pg_temp.org(o),'internal','timed','other','Einsatz',
    '2025-11-02T06:00:00Z'::timestamptz+d*interval '1 day'+s*interval '2 hours',
    '2025-11-02T06:00:00Z'::timestamptz+d*interval '1 day'+(s+1)*interval '2 hours'
  from generate_series(1,2) o, generate_series(0,364) d, generate_series(0,3) s where pg_temp.seeds(o, d between 337 and 343, p_history);
$$;

-- Per public table: sequential scans, and rows touched so far in this transaction.
create function pg_temp.table_reads() returns table(rel text, seq_scans bigint, touched bigint) language sql as $$
  select c.relname::text, pg_stat_get_xact_numscans(c.oid),
    pg_stat_get_xact_tuples_returned(c.oid)
      + coalesce((select sum(pg_stat_get_xact_tuples_returned(i.indexrelid)) from pg_index i where i.indrelid = c.oid), 0)::bigint
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
$$;
-- Runs one read twice and returns, per table, the sequential scans and rows the second run cost.
create function pg_temp.measure(p_read text) returns jsonb language plpgsql as $$
declare
  before jsonb;
  cost jsonb;
begin
  execute p_read;
  select jsonb_object_agg(rel, jsonb_build_array(seq_scans, touched)) into before from pg_temp.table_reads();
  execute p_read;
  select jsonb_build_object(
    'seqScans', coalesce(jsonb_object_agg(rel, seq_scans - (before->rel->>0)::bigint) filter (where seq_scans > (before->rel->>0)::bigint), '{}'),
    'touched', coalesce(jsonb_object_agg(rel, touched - (before->rel->>1)::bigint) filter (where touched > (before->rel->>1)::bigint), '{}'))
  into cost from pg_temp.table_reads();
  return cost;
end $$;
grant execute on all functions in schema pg_temp to service_role;

set local role service_role;
set local enable_seqscan = off;
do $$ declare
  -- Reads whose touched rows grow with the closed history, and why (werk-flow/werkflow-planning#340).
  -- Shrink-only: a read that stops growing fails until its entry goes.
  history_reads constant jsonb := jsonb_build_object(
    'plantafel-week', 'Every visit that started before the week''s end: no index bounds end_at.',
    'aufgaben-handover-candidates', 'Every project, handed-over ones included: no index holds the open-project filter.',
    'auftraege-manager', 'Every job, with its customer and project: the section counts and the order run over all visible jobs.',
    'auftraege-employee', 'Every job, with its customer, project and assignment probe: the section counts and the order run over all visible jobs.',
    'dokumente', 'The whole library: the page total counts it and the name order sorts it.');
  -- The planner's index-end probes (get_actual_variable_range) read a few entries that change with
  -- the statistics; every history in the seed is at least ten times larger.
  probe_noise constant integer := 10;
  job_query constant text := '{"page":1,"pageSize":50,"search":"","status":"alle","entryType":"alle","clientIds":[],"employeeIds":[],"dateFrom":"","dateTo":"","sort":"datum","direction":"desc","enabled":true}';
  -- Each read: the tables it bounds by organization, and its statement, where %1$L is the
  -- organization, %2$L its owner and %3$L its worker.
  reads constant jsonb := jsonb_build_object(
    -- Plantafel: the manager's week (lib/planning/calendar-entries.ts, loadPlanningCalendarEntries).
    'plantafel-week', jsonb_build_array('{planning_occurrences}', $q$select id from public.planning_occurrences where organization_id=%1$L
      and status in ('scheduled','skipped','cancelled')
      and ((start_at<'2026-10-11T22:00:00Z' and end_at>'2026-10-04T22:00:00Z') or (start_date<='2026-10-11' and end_date_exclusive>'2026-10-05'))
      order by start_at, id limit 1000$q$),
    -- Zeiterfassung: the worker's week (lib/time-tracking/entry-read-actions.ts, getTimeEntries).
    'zeiterfassung-week', jsonb_build_array('{time_entries}', $q$select id from public.time_entries where organization_id=%1$L
      and timestamp>='2026-10-04T22:00:00Z' and timestamp<='2026-10-11T21:59:59Z' and user_id=%3$L
      order by timestamp, created_at, id limit 1000$q$),
    -- Aufgaben: the time approvals (lib/time-tracking/approval-queue.ts, readPendingSessionQueue).
    'aufgaben-time-approvals', jsonb_build_array('{time_entries}', $q$select id from public.time_entries where organization_id=%1$L
      and status='pending' order by created_at desc, id limit 1000$q$),
    -- Aufgaben: the handover candidates (lib/attention/handover-tasks.ts).
    'aufgaben-handover-candidates', jsonb_build_array('{jobs,projects}', 'select * from public.list_handover_candidate_projects(%1$L)'),
    -- Aufträge: the first page of active work for a manager and an employee (lib/jobs/list-server.ts).
    'auftraege-manager', jsonb_build_array('{jobs,projects}',
      format('select public.list_job_entries_page(%%1$L,%%2$L,true,jsonb_build_object(''active'',%L::jsonb))', job_query)),
    'auftraege-employee', jsonb_build_array('{jobs,projects}',
      format('select public.list_job_entries_page(%%1$L,%%3$L,false,jsonb_build_object(''active'',%L::jsonb))', job_query)),
    -- Dokumente: the first page of the library (lib/documents/library-actions.ts).
    'dokumente', jsonb_build_array('{documents}', $q$select public.list_document_page(%1$L,'{"view":"all","sort":"name","page":1,"pageSize":50}')$q$));
  ids hot_ids;
  label text;
  read jsonb;
  template text;
  before jsonb := '{}';
  costs jsonb := '{}';
  large jsonb;
  small jsonb;
  table_name text;
  grown bigint;
begin
  select * into ids from hot_ids;
  perform pg_temp.seed(false);
  for label, read in select key, value from jsonb_each(reads) loop
    template := read->>1;
    before := before || jsonb_build_object(label, pg_temp.measure(format(template, ids.small_org, ids.owner, ids.small_worker)));
  end loop;
  perform pg_temp.seed(true);
  for label, read in select key, value from jsonb_each(reads) loop
    template := read->>1;
    small := pg_temp.measure(format(template, ids.small_org, ids.owner, ids.small_worker));
    large := pg_temp.measure(format(template, ids.large_org, ids.owner, ids.large_worker));
    costs := costs || jsonb_build_object(label, jsonb_build_object('large', large->'touched', 'small', small->'touched'));
    if large->'seqScans' <> '{}' or small->'seqScans' <> '{}' then
      raise exception 'hot read % scans a table sequentially: no index serves its predicate (%)', label, large->'seqScans';
    end if;
    for table_name in select jsonb_object_keys(small->'touched') union select jsonb_object_keys(before->label->'touched') loop
      if abs(coalesce((small->'touched'->>table_name)::bigint, 0) - coalesce((before->label->'touched'->>table_name)::bigint, 0)) > probe_noise then
        raise exception 'hot read % touches % once another organization holds a history, % before: it reads beyond its organization',
          label, small->'touched', before->label->'touched';
      end if;
    end loop;
    grown := 0;
    for table_name in select jsonb_object_keys(large->'touched') union select jsonb_object_keys(small->'touched') loop
      if abs(coalesce((large->'touched'->>table_name)::bigint, 0) - coalesce((small->'touched'->>table_name)::bigint, 0)) > probe_noise then
        if not history_reads ? label then
          raise exception 'hot read % touches % rows of % in the organization with a closed history, % without',
            label, large->'touched'->>table_name, table_name, coalesce(small->'touched'->>table_name, '0');
        end if;
        grown := grown + 1;
      end if;
    end loop;
    if history_reads ? label and grown = 0 then
      raise exception 'hot read % no longer reads the closed history: remove its HISTORY_READS entry', label;
    end if;
  end loop;
  -- The counters see the index entries an index returns, not the ones it walks past. Without an
  -- index that leads with organization_id, the planner walks one that holds it further back, such
  -- as the (id, organization_id) replica identity, and the walk stays invisible here. A partial
  -- index serves only reads that imply its predicate, so only a whole one counts.
  for label, table_name in select key, unnest((value->>0)::text[]) from jsonb_each(reads) loop
    if not exists(select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indrelid = ('public.'||table_name)::regclass and i.indisvalid and i.indpred is null and a.attname = 'organization_id') then
      raise exception 'hot read % bounds % by organization, but no whole index of % leads with organization_id', label, table_name, table_name;
    end if;
  end loop;
  raise notice 'hot read costs %', costs;
end $$;
reset role;
rollback;
