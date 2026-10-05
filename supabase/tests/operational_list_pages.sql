-- Service-only page readers: complete filtering/counting before page selection.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('74000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lists-owner@example.test','',now(),'{}','{"first_name":"Lists","last_name":"Owner"}',now(),now()),
('74000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lists-worker@example.test','',now(),'{}','{"first_name":"Lists","last_name":"Worker"}',now(),now());
set local role service_role;
insert into public.organizations(id,name,admin_id,unique_code) values
('74000000-0000-4000-8000-000000000010','List pages','74000000-0000-4000-8000-000000000001','LISTSQLA'),
('74000000-0000-4000-8000-000000000011','Other list pages','74000000-0000-4000-8000-000000000001','LISTSQLB');
insert into public.organization_members(organization_id,user_id,role) values ('74000000-0000-4000-8000-000000000010','74000000-0000-4000-8000-000000000002','employee');
insert into public.clients(id,organization_id,name) select md5('list-client-'||number)::uuid,'74000000-0000-4000-8000-000000000010','Kunde '||lpad(number::text,4,'0') from generate_series(1,1051) number;
insert into public.clients(id,organization_id,name) values ('74000000-0000-4000-8000-000000000099','74000000-0000-4000-8000-000000000011','Foreign');
insert into public.client_contacts(client_id,organization_id,name) values(md5('list-client-1051')::uuid,'74000000-0000-4000-8000-000000000010','Später Ansprechpartner 50%_');
insert into public.client_sites(client_id,organization_id,name,street,postal_code,city) values(md5('list-client-1050')::uuid,'74000000-0000-4000-8000-000000000010','Werkstatt','Nebenstraße','12345','Suchstadt');
insert into public.projects(id,organization_id,name,project_number,created_by) values('74000000-0000-4000-8000-000000000020','74000000-0000-4000-8000-000000000010','Projekt','PAGE-P','74000000-0000-4000-8000-000000000001');
insert into public.jobs(id,organization_id,title,job_number,created_by,client_id)
select md5('list-job-'||number)::uuid,'74000000-0000-4000-8000-000000000010','Auftrag '||lpad(number::text,4,'0'),'PAGE-'||number,'74000000-0000-4000-8000-000000000001',md5('list-client-'||number)::uuid from generate_series(1,1051) number;
insert into public.jobs(id,organization_id,title,job_number,created_by,project_id)
select md5('list-child-'||number)::uuid,'74000000-0000-4000-8000-000000000010','Projektarbeit '||number,'CHILD-'||number,'74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000020' from generate_series(1,55) number;
insert into public.job_assignments(organization_id,job_id,user_id,assigned_by) values
('74000000-0000-4000-8000-000000000010',md5('list-child-55')::uuid,'74000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001');
insert into public.documents(id,organization_id,storage_path,original_file_name,display_name,size_bytes,uploaded_by)
select md5('list-doc-'||number)::uuid,'74000000-0000-4000-8000-000000000010','74000000-0000-4000-8000-000000000010/list-page/'||number,'file.txt','Datei '||lpad(number::text,4,'0'),1,'74000000-0000-4000-8000-000000000001' from generate_series(1,1051) number;
insert into public.document_links(organization_id,document_id,client_id,created_by)
select '74000000-0000-4000-8000-000000000010',md5('list-doc-'||number)::uuid,md5('list-client-'||number)::uuid,'74000000-0000-4000-8000-000000000001' from generate_series(1,1050) number;

do $$ declare
  org_id uuid := '74000000-0000-4000-8000-000000000010';
  owner_id uuid := '74000000-0000-4000-8000-000000000001';
  worker_id uuid := '74000000-0000-4000-8000-000000000002';
  query jsonb := '{"page":1,"pageSize":50,"search":"","status":"alle","entryType":"alle","clientIds":[],"employeeIds":[],"dateFrom":"","dateTo":"","sort":"bezeichnung","direction":"asc","enabled":true}';
  result jsonb; next_result jsonb; signature text;
begin
  foreach signature in array array['public.list_customer_page(uuid,text,integer,integer)','public.list_job_entries_page(uuid,uuid,boolean,jsonb)','public.list_project_job_page(uuid,uuid,boolean,uuid,integer,integer)','public.list_document_page(uuid,jsonb)','public.list_request_page(uuid,text,text,text[],integer,integer)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'page RPC grant mismatch: %',signature; end if;
  end loop;
  result := public.list_customer_page(org_id,'',1,50);
  if jsonb_array_length(result->'clients')<>50 or result->'ids'<>(select jsonb_agg(value->'id') from jsonb_array_elements(result->'clients')) then raise exception 'customer row payload is not the ordered bounded id page'; end if;
  if exists(select 1 from jsonb_array_elements(result->'clients') client where client->>'organizationId'<>org_id::text or not (client ?& array['id','organizationId','name','clientType','customerNumber','email','phone','address','notes','createdAt','updatedAt'])) then raise exception 'customer payload scope or shape changed'; end if;
  result := public.list_customer_page(org_id,'',22,50);
  if (result->>'total')::int<>1051 or jsonb_array_length(result->'ids')<>1 then raise exception 'customer last page or global count incomplete: %',result; end if;
  if jsonb_array_length(result->'clients')<>1 or result#>>'{clients,0,name}'<>'Kunde 1051' then raise exception 'customer tail row hydration lost'; end if;
  result := public.list_customer_page(org_id,'50%_',1,50);
  if result->'ids'<>jsonb_build_array(md5('list-client-1051')::uuid) then raise exception 'literal contact search missed tail'; end if;
  if result#>>'{clients,0,id}'<>md5('list-client-1051')::uuid::text then raise exception 'customer contact match payload lost'; end if;
  result := public.list_customer_page(org_id,'Nebenstraße 12345 Suchstadt',1,50);
  if result->'ids'<>jsonb_build_array(md5('list-client-1050')::uuid) then raise exception 'site address search missed tail'; end if;
  result := public.list_customer_page(org_id,'Foreign',1,50);
  if (result->>'total')::int<>0 or result->'clients'<>'[]'::jsonb then raise exception 'customer tenant leaked'; end if;
  result := public.list_job_entries_page(org_id,owner_id,true,jsonb_build_object('active',query));
  next_result := public.list_job_entries_page(org_id,owner_id,true,jsonb_build_object('active',query||'{"page":2}'));
  if (result#>>'{active,total}')::int<>1052 or jsonb_array_length(result#>'{active,entries}')<>50 then raise exception 'unified parent totals/page wrong'; end if;
  if exists(select 1 from jsonb_array_elements(result#>'{active,entries}') a join jsonb_array_elements(next_result#>'{active,entries}') b on a->>'id'=b->>'id') then raise exception 'parent pages overlap'; end if;
  result := public.list_job_entries_page(org_id,owner_id,true,jsonb_build_object('active',query||'{"search":"Projektarbeit 55"}'));
  if (result#>>'{active,total}')::int<>1 or result#>>'{active,entries,0,id}'<>'74000000-0000-4000-8000-000000000020' or (result#>>'{active,entries,0,jobCount}')::int<>55 then raise exception 'child search lost grouping or full aggregate'; end if;
  result := public.list_job_entries_page(org_id,worker_id,false,jsonb_build_object('active',query));
  if (result#>>'{active,total}')::int<>1 or (result#>>'{active,entries,0,jobCount}')::int<>1 then raise exception 'employee scope leaked hidden jobs'; end if;
  result := public.list_project_job_page(org_id,owner_id,true,'74000000-0000-4000-8000-000000000020',2,50);
  if (result->>'total')::int<>55 or jsonb_array_length(result->'ids')<>5 then raise exception 'project child page incomplete'; end if;
  result := public.list_project_job_page(org_id,worker_id,false,'74000000-0000-4000-8000-000000000020',1,50);
  if result->'ids'<>jsonb_build_array(md5('list-child-55')::uuid) then raise exception 'project child role scope leaked'; end if;
  result := public.list_document_page(org_id,'{"view":"all","sort":"name","linkFilter":"unlinked","page":1,"pageSize":50}');
  if result->'ids'<>jsonb_build_array(md5('list-doc-1051')::uuid) then raise exception 'unlinked filter stopped at 1000 links'; end if;
  result := public.list_document_page(org_id,'{"view":"clients","sort":"name","page":21,"pageSize":50}');
  if (result->>'total')::int<>1050 or jsonb_array_length(result->'ids')<>50 then raise exception 'linked document last page incomplete'; end if;
end $$;
-- Equal sort values must preserve newest-created-first across the page boundary.
-- Hashed identities deliberately differ from creation order.
insert into public.jobs(id,organization_id,title,created_by,planned_date,created_at)
select md5('sort-null-'||number)::uuid,'74000000-0000-4000-8000-000000000010','Sort Null '||number,
  '74000000-0000-4000-8000-000000000001',null,'2026-01-01T00:00:00Z'::timestamptz + number * interval '1 second'
from generate_series(1,55) number;
insert into public.jobs(id,organization_id,title,created_by,planned_date,created_at)
select md5('sort-date-'||number)::uuid,'74000000-0000-4000-8000-000000000010','Sort Date '||number,
  '74000000-0000-4000-8000-000000000001','2026-09-08','2026-01-01T00:00:00Z'::timestamptz + number * interval '1 second'
from generate_series(1,55) number;
insert into public.projects(id,organization_id,name,created_by,planned_start_date,created_at)
select md5('sort-project-'||number)::uuid,'74000000-0000-4000-8000-000000000010','Sort Project '||number,
  '74000000-0000-4000-8000-000000000001','2026-09-08','2026-01-01T00:00:00Z'::timestamptz + number * interval '1 second'
from generate_series(1,55) number;

do $$ declare
  example record; direction text; page_number integer; result jsonb;
  query jsonb := '{"pageSize":50,"status":"alle","entryType":"alle","clientIds":[],"employeeIds":[],"dateFrom":"","dateTo":"","sort":"datum","enabled":true}';
begin
  for example in select * from (values ('Sort Null','sort-null-'),('Sort Date','sort-date-'),('Sort Project','sort-project-')) cases(search,prefix) loop
    foreach direction in array array['asc','desc'] loop
      for page_number in 1..2 loop
        result := public.list_job_entries_page('74000000-0000-4000-8000-000000000010','74000000-0000-4000-8000-000000000001',true,
          jsonb_build_object('active',query||jsonb_build_object('search',example.search,'direction',direction,'page',page_number)));
        if (result#>>'{active,total}')::int<>55 or jsonb_array_length(result#>'{active,entries}')<>(case when page_number=1 then 50 else 5 end) then
          raise exception 'equal-date total/page incorrect for %',example.search;
        end if;
        if exists(select 1 from jsonb_array_elements(result#>'{active,entries}') with ordinality listed(entry,position)
          where entry->>'id'<>md5(example.prefix||(56-(page_number-1)*50-position)::text)::uuid::text) then
          raise exception 'equal-date creation order changed across page % for % (%)',page_number,example.search,direction;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- Identical timestamps still need a stable final key.
insert into public.jobs(id,organization_id,title,created_by,created_at) values
('74000000-0000-4000-8000-000000000082','74000000-0000-4000-8000-000000000010','Sort Same Timestamp','74000000-0000-4000-8000-000000000001','2026-01-01'),
('74000000-0000-4000-8000-000000000081','74000000-0000-4000-8000-000000000010','Sort Same Timestamp','74000000-0000-4000-8000-000000000001','2026-01-01');
do $$ declare result jsonb;
begin
  result := public.list_job_entries_page('74000000-0000-4000-8000-000000000010','74000000-0000-4000-8000-000000000001',true,
    '{"active":{"page":1,"pageSize":50,"search":"Sort Same Timestamp","sort":"datum","direction":"desc"}}');
  if result#>>'{active,entries,0,id}'<>'74000000-0000-4000-8000-000000000081' or result#>>'{active,entries,1,id}'<>'74000000-0000-4000-8000-000000000082' then
    raise exception 'identical creation timestamps lost deterministic identity order';
  end if;
end $$;

-- The "Nr." sort orders record numbers by year, then by the numeric sequence,
-- across the page boundary; a number outside the form sorts last ascending and
-- first descending.
insert into public.jobs(id,organization_id,title,job_number,created_by)
select md5('natural-job-'||number)::uuid,'74000000-0000-4000-8000-000000000010','Naturnummer '||number,number,'74000000-0000-4000-8000-000000000001'
from unnest(array['AUF-2026-1000','AUF-2026-101','ALT-7','AUF-2026-100','AUF-2025-1200','AUF-2026-099']) number;
do $$ declare
  expected text[] := array['AUF-2025-1200','AUF-2026-099','AUF-2026-100','AUF-2026-101','AUF-2026-1000','ALT-7'];
  direction text; page_number integer; position integer; result jsonb;
begin
  foreach direction in array array['asc','desc'] loop
    for page_number in 1..3 loop
      result := public.list_job_entries_page('74000000-0000-4000-8000-000000000010','74000000-0000-4000-8000-000000000001',true,
        jsonb_build_object('active',jsonb_build_object('page',page_number,'pageSize',2,'search','Naturnummer','sort','nr','direction',direction)));
      for position in 1..2 loop
        if result#>>array['active','entries',(position-1)::text,'id']<>md5('natural-job-'||expected[case when direction='asc' then page_number*2-2+position else 7-(page_number*2-2+position) end])::uuid::text then
          raise exception 'job numbers do not sort naturally on page % (%)',page_number,direction;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- Request pages: status scope, search and count before the page boundary, newest first.
insert into public.client_requests(id,organization_id,summary,status,category,client_id,assigned_to,received_at)
select md5('list-request-'||number)::uuid,'74000000-0000-4000-8000-000000000010','Anfrage '||lpad(number::text,4,'0'),
  (case when number<=5 then 'in_klaerung' else 'offen' end)::public.request_status,
  (case when number=7 then 'wartung' else 'sonstiges' end)::public.request_category,
  case when number=120 then md5('list-client-1051')::uuid end,
  case when number=119 then '74000000-0000-4000-8000-000000000002'::uuid end,
  '2026-01-01T00:00:00Z'::timestamptz + number * interval '1 minute'
from generate_series(1,120) number;
insert into public.client_requests(organization_id,summary) values('74000000-0000-4000-8000-000000000011','Fremde Anfrage');
do $$ declare
  org_id uuid := '74000000-0000-4000-8000-000000000010';
  result jsonb;
begin
  result := public.list_request_page(org_id,'aktiv','','{}',1,50);
  if (result->>'total')::int<>120 or jsonb_array_length(result->'rows')<>50 or not (result->>'hasAny')::boolean then raise exception 'request page total or size wrong: %',result->>'total'; end if;
  if exists(select 1 from jsonb_array_elements(result->'rows') with ordinality listed(entry,position) where entry->>'id'<>md5('list-request-'||(121-position))::uuid::text) then raise exception 'request page is not newest first'; end if;
  if result#>>'{rows,0,clientName}'<>'Kunde 1051' or result#>>'{rows,1,assigneeEmail}'<>'lists-worker@example.test' or not (result#>>'{rows,1,hasAssignee}')::boolean or (result#>>'{rows,2,hasAssignee}')::boolean then raise exception 'request row labels lost'; end if;
  result := public.list_request_page(org_id,'aktiv','','{}',3,50);
  if (result->>'total')::int<>120 or jsonb_array_length(result->'rows')<>20 or result#>>'{rows,19,id}'<>md5('list-request-1')::uuid::text then raise exception 'request last page incomplete'; end if;
  -- Bounds: at most 100 rows, at least one row, and never a page before the first.
  if jsonb_array_length(public.list_request_page(org_id,'aktiv','','{}',1,100000)->'rows')<>100 then raise exception 'request page size is not capped at 100'; end if;
  if jsonb_array_length(public.list_request_page(org_id,'aktiv','','{}',1,0)->'rows')<>1 then raise exception 'request page size has no lower bound'; end if;
  if public.list_request_page(org_id,'aktiv','','{}',-3,50)#>>'{rows,0,id}'<>md5('list-request-120')::uuid::text then raise exception 'request page number has no lower bound'; end if;
  result := public.list_request_page(org_id,'aktiv','','{}',2147483647,100);
  if (result->>'total')::int<>120 or result->'rows'<>'[]'::jsonb then raise exception 'request page past the end is not empty'; end if;
  -- Status scope and search count before paging.
  if (public.list_request_page(org_id,'in_klaerung','','{}',1,50)->>'total')::int<>5 or (public.list_request_page(org_id,'geschlossen','','{}',1,50)->>'total')::int<>0 or (public.list_request_page(org_id,'alle','','{}',1,50)->>'total')::int<>120 then raise exception 'request status scope wrong'; end if;
  result := public.list_request_page(org_id,'aktiv','anfrage 0001','{}',1,50);
  if (result->>'total')::int<>1 or result#>>'{rows,0,id}'<>md5('list-request-1')::uuid::text then raise exception 'request search missed the oldest row'; end if;
  if public.list_request_page(org_id,'aktiv','kunde 1051','{}',1,50)#>>'{rows,0,id}'<>md5('list-request-120')::uuid::text or public.list_request_page(org_id,'aktiv','lists-worker','{}',1,50)#>>'{rows,0,id}'<>md5('list-request-119')::uuid::text then raise exception 'request search missed customer or assignee'; end if;
  result := public.list_request_page(org_id,'aktiv','wartung',array['wartung'],1,50);
  if (result->>'total')::int<>1 or result#>>'{rows,0,id}'<>md5('list-request-7')::uuid::text then raise exception 'request category search wrong'; end if;
  -- Tenant isolation: the other organization's request is neither counted nor found, and an organization without requests reports none.
  result := public.list_request_page(org_id,'alle','Fremde','{}',1,50);
  if (result->>'total')::int<>0 or result->'rows'<>'[]'::jsonb then raise exception 'request tenant leaked'; end if;
  result := public.list_request_page('74000000-0000-4000-8000-000000000011','alle','','{}',1,50);
  if (result->>'total')::int<>1 or jsonb_array_length(result->'rows')<>1 then raise exception 'foreign organization page wrong'; end if;
  result := public.list_request_page('74000000-0000-4000-8000-000000000012','alle','','{}',1,50);
  if (result->>'total')::int<>0 or (result->>'hasAny')::boolean then raise exception 'empty organization reports requests'; end if;
end $$;
rollback;
