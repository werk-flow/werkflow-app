-- Service-only page reader of the correction history: the visibility each
-- caller class resolves to, the count and the page boundary apply in the
-- database, more than 1,000 requests stay reachable newest first, a foreign
-- organization neither counts nor matches, and browser roles cannot execute
-- the reader.
-- Runs inside one transaction against the local stack and rolls back.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('77000000-0000-4000-8000-000000000001','history-admin@example.test'),
  ('77000000-0000-4000-8000-000000000002','history-buero@example.test'),
  ('77000000-0000-4000-8000-000000000003','history-employee@example.test'),
  ('77000000-0000-4000-8000-000000000004','history-colleague@example.test'),
  ('77000000-0000-4000-8000-000000000005','history-former@example.test')
) users(id,email);
insert into public.organizations(id,name,admin_id,unique_code) values
('77000000-0000-4000-8000-000000000010','Correction history pages','77000000-0000-4000-8000-000000000001','TCHISTA'),
('77000000-0000-4000-8000-000000000011','Other correction history pages','77000000-0000-4000-8000-000000000001','TCHISTB');
-- Creating an organization adds its admin as a member.
insert into public.organization_members(organization_id,user_id,role) values
('77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000002','buero'),
('77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000003','employee'),
('77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000004','employee');

-- Requests are written only through their RPCs; the seed bypasses the
-- triggers and the employee-record reference. Request n was filed n minutes
-- after the base:
-- * 1..1051: the colleague (employee) about themself;
-- * 1052..1054: the Büro member about themself;
-- * 1055..1056: the caller (employee) about themself;
-- * 1057: the admin about a former member, who no longer belongs to the organization.
set local session_replication_role = replica;
insert into public.time_correction_requests(id,organization_id,subject_employee_record_id,subject_user_id,requested_by,kind,status,source_scope_key,created_at)
select md5('tc-'||number)::uuid,'77000000-0000-4000-8000-000000000010',md5('tc-record-'||number)::uuid,subject::uuid,requester::uuid,
  'add','withdrawn',md5('tc-scope-a-'||number)||md5('tc-scope-b-'||number),
  '2026-01-01T00:00:00Z'::timestamptz + number * interval '1 minute'
from (
  select number,
    case when number<=1051 then '77000000-0000-4000-8000-000000000004'
      when number<=1054 then '77000000-0000-4000-8000-000000000002'
      when number<=1056 then '77000000-0000-4000-8000-000000000003'
      else '77000000-0000-4000-8000-000000000005' end as subject,
    case when number<=1051 then '77000000-0000-4000-8000-000000000004'
      when number<=1054 then '77000000-0000-4000-8000-000000000002'
      when number<=1056 then '77000000-0000-4000-8000-000000000003'
      else '77000000-0000-4000-8000-000000000001' end as requester
  from generate_series(1,1057) number
) seeded;
insert into public.time_correction_requests(id,organization_id,subject_employee_record_id,subject_user_id,requested_by,kind,status,source_scope_key) values
('77000000-0000-4000-8000-000000000090','77000000-0000-4000-8000-000000000011','77000000-0000-4000-8000-000000000091','77000000-0000-4000-8000-000000000003','77000000-0000-4000-8000-000000000003','add','withdrawn',md5('tc-foreign-a')||md5('tc-foreign-b'));
set local session_replication_role = origin;

set local role service_role;

do $$ declare
  org_id uuid := '77000000-0000-4000-8000-000000000010';
  caller uuid := '77000000-0000-4000-8000-000000000003';
  result jsonb; next_result jsonb;
  signature text := 'public.list_time_correction_history_page(uuid,uuid,text,integer,integer)';
begin
  if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'history page RPC grant mismatch'; end if;

  -- Admin and Büro: the whole history, newest first, counted before the page boundary.
  result := public.list_time_correction_history_page(org_id,'77000000-0000-4000-8000-000000000002','all');
  if (result->>'total')::int<>1057 or jsonb_array_length(result->'ids')<>50 then raise exception 'full history first page or total wrong: %',result->>'total'; end if;
  if exists(select 1 from jsonb_array_elements_text(result->'ids') with ordinality listed(id,position) where id<>md5('tc-'||(1058-position))::uuid::text) then raise exception 'history page is not newest first'; end if;
  next_result := public.list_time_correction_history_page(org_id,'77000000-0000-4000-8000-000000000002','all',2);
  if exists(select 1 from jsonb_array_elements(result->'ids') a join jsonb_array_elements(next_result->'ids') b on a=b) then raise exception 'history pages overlap'; end if;
  result := public.list_time_correction_history_page(org_id,'77000000-0000-4000-8000-000000000002','all',22);
  if jsonb_array_length(result->'ids')<>7 or result->'ids'->>6<>md5('tc-1')::uuid::text then raise exception 'history tail beyond 1,000 rows unreachable'; end if;

  -- An employee who reviews nobody: only the requests they filed or are the subject of.
  result := public.list_time_correction_history_page(org_id,caller,'own');
  if (result->>'total')::int<>2 or result->'ids'<>jsonb_build_array(md5('tc-1056')::uuid,md5('tc-1055')::uuid) then raise exception 'own history wrong: %',result; end if;
  -- An employee approving through a Büro source: their own and every employee subject, never a Büro or former subject.
  result := public.list_time_correction_history_page(org_id,caller,'own_and_employee_subjects');
  if (result->>'total')::int<>1053 or result->'ids'->>0<>md5('tc-1056')::uuid::text or result->'ids'->>2<>md5('tc-1051')::uuid::text then raise exception 'delegated employee history wrong: %',result->>'total'; end if;
  if public.list_time_correction_history_page(org_id,caller,'own_and_employee_subjects',22)->'ids'<>jsonb_build_array(md5('tc-3')::uuid,md5('tc-2')::uuid,md5('tc-1')::uuid) then raise exception 'delegated employee tail unreachable'; end if;
  -- A Büro member who only sees their own (the rule follows the passed visibility, not the role).
  if (public.list_time_correction_history_page(org_id,'77000000-0000-4000-8000-000000000002','own')->>'total')::int<>3 then raise exception 'own history of a Büro subject wrong'; end if;
  -- An unknown visibility lists nothing.
  result := public.list_time_correction_history_page(org_id,caller,'everything');
  if (result->>'total')::int<>0 or result->'ids'<>'[]'::jsonb then raise exception 'an unknown visibility lists requests'; end if;

  -- Bounds: at most 100 rows, at least one row, never a page before the first, empty past the end.
  if jsonb_array_length(public.list_time_correction_history_page(org_id,caller,'all',1,100000)->'ids')<>100 then raise exception 'history page size is not capped at 100'; end if;
  if jsonb_array_length(public.list_time_correction_history_page(org_id,caller,'all',1,0)->'ids')<>1 then raise exception 'history page size has no lower bound'; end if;
  if public.list_time_correction_history_page(org_id,caller,'all',-3)->'ids'->>0<>md5('tc-1057')::uuid::text then raise exception 'history page number has no lower bound'; end if;
  result := public.list_time_correction_history_page(org_id,caller,'all',2147483647,100);
  if (result->>'total')::int<>1057 or result->'ids'<>'[]'::jsonb then raise exception 'history page past the end is not empty'; end if;

  -- Tenant isolation: the caller's own request in the other organization never lists here, and vice versa.
  if exists(select 1 from jsonb_array_elements_text(public.list_time_correction_history_page(org_id,caller,'own')->'ids') listed(id) where id='77000000-0000-4000-8000-000000000090') then raise exception 'history tenant leaked'; end if;
  result := public.list_time_correction_history_page('77000000-0000-4000-8000-000000000011',caller,'all');
  if (result->>'total')::int<>1 or result->'ids'<>jsonb_build_array('77000000-0000-4000-8000-000000000090'::uuid) then raise exception 'foreign organization history wrong'; end if;
  result := public.list_time_correction_history_page('77000000-0000-4000-8000-000000000012',caller,'all');
  if (result->>'total')::int<>0 or result->'ids'<>'[]'::jsonb then raise exception 'empty organization reports history'; end if;
end $$;

-- Identical filing times keep a deterministic identity order across the page boundary.
reset role;
set local session_replication_role = replica;
insert into public.time_correction_requests(id,organization_id,subject_employee_record_id,subject_user_id,requested_by,kind,status,source_scope_key,created_at) values
('77000000-0000-4000-8000-000000000082','77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000093','77000000-0000-4000-8000-000000000005','77000000-0000-4000-8000-000000000005','add','withdrawn',md5('tc-same-b')||md5('tc-same-b'),'2027-01-01'),
('77000000-0000-4000-8000-000000000081','77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000093','77000000-0000-4000-8000-000000000005','77000000-0000-4000-8000-000000000005','add','withdrawn',md5('tc-same-a')||md5('tc-same-a'),'2027-01-01');
set local session_replication_role = origin;
set local role service_role;
do $$ begin
  if public.list_time_correction_history_page('77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000005','own',1,1)->'ids'<>jsonb_build_array('77000000-0000-4000-8000-000000000081'::uuid)
    or public.list_time_correction_history_page('77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000005','own',2,1)->'ids'<>jsonb_build_array('77000000-0000-4000-8000-000000000082'::uuid) then
    raise exception 'identical filing times lost the id order';
  end if;
end $$;

-- A browser session cannot execute the reader, even for its own organization.
reset role;
set local role authenticated;
do $$ begin
  perform public.list_time_correction_history_page('77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000003','all');
  raise exception 'authenticated executed list_time_correction_history_page';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role anon;
do $$ begin
  perform public.list_time_correction_history_page('77000000-0000-4000-8000-000000000010','77000000-0000-4000-8000-000000000003','all');
  raise exception 'anon executed list_time_correction_history_page';
exception when insufficient_privilege then null;
end $$;
reset role;
rollback;
