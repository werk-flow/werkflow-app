-- Bounded planning options, retained identity and service-only execution.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('75000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','planning-options@example.test','',now(),'{}','{"first_name":"Admin","last_name":"Fixture"}',now(),now()),
('75000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','planning-worker@example.test','',now(),'{}','{"first_name":"Aktuell","last_name":"Profil"}',now(),now());
set local role service_role;
insert into public.organizations(id,name,admin_id,unique_code) values
('75000000-0000-4000-8000-000000000010','Planning options','75000000-0000-4000-8000-000000000001','PLANOPTA'),
('75000000-0000-4000-8000-000000000011','Other planning options','75000000-0000-4000-8000-000000000001','PLANOPTB');
insert into public.jobs(id,organization_id,title,job_number,created_by)
select md5('planning-option-job-'||number)::uuid,'75000000-0000-4000-8000-000000000010','Auftrag '||lpad(number::text,4,'0'),'OPT-'||lpad(number::text,4,'0'),'75000000-0000-4000-8000-000000000001' from generate_series(1,1051) number;
insert into public.employee_records(id,organization_id,first_name,last_name,employee_number)
select md5('planning-option-person-'||number)::uuid,'75000000-0000-4000-8000-000000000010','Person',lpad(number::text,4,'0'),'EMP-'||number from generate_series(1,251) number;
insert into public.teams(id,organization_id,name)
select md5('planning-option-team-'||number)::uuid,'75000000-0000-4000-8000-000000000010','Team '||lpad(number::text,4,'0') from generate_series(1,151) number;
insert into public.employee_records(id,organization_id,user_id,first_name,last_name,exit_date) values
('75000000-0000-4000-8000-000000000020','75000000-0000-4000-8000-000000000010','75000000-0000-4000-8000-000000000002','Veralteter','Datensatz',current_date-1),
('75000000-0000-4000-8000-000000000021','75000000-0000-4000-8000-000000000011',null,'Fremde','Person',null);
insert into public.teams(id,organization_id,name) values
('75000000-0000-4000-8000-000000000022','75000000-0000-4000-8000-000000000011','Fremdes Team');
insert into public.jobs(id,organization_id,title,created_by) values
('75000000-0000-4000-8000-000000000023','75000000-0000-4000-8000-000000000011','Fremder Auftrag','75000000-0000-4000-8000-000000000001');
do $$ declare
  org_id uuid := '75000000-0000-4000-8000-000000000010';
  result jsonb; next_result jsonb; kind text;
  signature text := 'public.search_planning_options(uuid,text,text,integer,uuid[],uuid[])';
begin
  if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'planning option grants are not service-only'; end if;
  foreach kind in array array['jobs','employees','teams'] loop
    result := public.search_planning_options(org_id,kind,'',0);
    next_result := public.search_planning_options(org_id,kind,'',50);
    if jsonb_array_length(result->'options') IS DISTINCT FROM 50 or (result->>'hasMore')::boolean is not true then raise exception '% first page is not bounded',kind; end if;
    if jsonb_array_length(next_result->'options') IS DISTINCT FROM 50 then raise exception '% continuation missing',kind; end if;
    if exists(select 1 from jsonb_array_elements(result->'options') first_page join jsonb_array_elements(next_result->'options') next_page on first_page->>'value'=next_page->>'value') then raise exception '% pages overlap',kind; end if;
    result := public.search_planning_options(org_id,kind,'Fremd',0,array['75000000-0000-4000-8000-000000000021','75000000-0000-4000-8000-000000000022','75000000-0000-4000-8000-000000000023']::uuid[]);
    if result->'options' IS DISTINCT FROM '[]'::jsonb or result->'selected' IS DISTINCT FROM '[]'::jsonb then raise exception '% foreign choices leaked',kind; end if;
  end loop;
  result := public.search_planning_options(org_id,'jobs','1051',0);
  if result#>>'{options,0,value}' IS DISTINCT FROM md5('planning-option-job-1051')::uuid::text or jsonb_array_length(result->'options') IS DISTINCT FROM 1 then raise exception 'job search stopped at old row limit'; end if;
  result := public.search_planning_options(org_id,'employees','0251',0);
  if result#>>'{options,0,value}' IS DISTINCT FROM md5('planning-option-person-251')::uuid::text or jsonb_array_length(result->'options') IS DISTINCT FROM 1 then raise exception 'personnel search stopped at old limit'; end if;
  result := public.search_planning_options(org_id,'teams','0151',0);
  if result#>>'{options,0,value}' IS DISTINCT FROM md5('planning-option-team-151')::uuid::text or jsonb_array_length(result->'options') IS DISTINCT FROM 1 then raise exception 'team search stopped at old limit'; end if;
  result := public.search_planning_options(org_id,'employees','does not match',0,array['75000000-0000-4000-8000-000000000020']::uuid[]);
  if result#>>'{selected,0,label}' IS DISTINCT FROM 'Aktuell Profil' or jsonb_array_length(result->'selected') IS DISTINCT FROM 1 then raise exception 'retained selection lost authoritative profile'; end if;
  result := public.search_planning_options(org_id,'employees','',0,'{}',array['75000000-0000-4000-8000-000000000002']::uuid[]);
  if result->'selected' IS DISTINCT FROM '[]'::jsonb then raise exception 'exited worker was automatically preselected'; end if;
  update public.employee_records set exit_date=null where id='75000000-0000-4000-8000-000000000020';
  result := public.search_planning_options(org_id,'employees','Aktuell Profil',0,'{}',array['75000000-0000-4000-8000-000000000002']::uuid[]);
  if result#>>'{selected,0,value}' IS DISTINCT FROM '75000000-0000-4000-8000-000000000020' or result#>>'{options,0,label}' IS DISTINCT FROM 'Aktuell Profil' or jsonb_array_length(result->'selected') IS DISTINCT FROM 1 or jsonb_array_length(result->'options') IS DISTINCT FROM 1 then raise exception 'active default or authoritative name search missing'; end if;
  update public.jobs set status='fertig' where id=md5('planning-option-job-1051')::uuid;
  result := public.search_planning_options(org_id,'jobs','1051',0,array[md5('planning-option-job-1051')::uuid]);
  if result->'options' IS DISTINCT FROM '[]'::jsonb or jsonb_array_length(result->'selected') IS DISTINCT FROM 1 then raise exception 'closed job eligibility or retained label wrong'; end if;
  update public.teams set dissolved_at=now() where id=md5('planning-option-team-151')::uuid;
  result := public.search_planning_options(org_id,'teams','0151',0,array[md5('planning-option-team-151')::uuid]);
  if result->'options' IS DISTINCT FROM '[]'::jsonb or jsonb_array_length(result->'selected') IS DISTINCT FROM 1 then raise exception 'dissolved team eligibility or retained label wrong'; end if;
end $$;
-- Job choices order their number by year, then by the numeric sequence, also
-- behind an offset; a number outside the form sorts last.
insert into public.jobs(id,organization_id,title,job_number,created_by)
select md5('natural-option-'||number)::uuid,'75000000-0000-4000-8000-000000000010','Naturnummer',number,'75000000-0000-4000-8000-000000000001'
from unnest(array['AUF-2026-1000','AUF-2026-101','ALT-7','AUF-2026-100','AUF-2025-1200','AUF-2026-099']) number;
do $$ declare
  expected jsonb := (select jsonb_agg(md5('natural-option-'||number)::uuid order by position)
    from unnest(array['AUF-2025-1200','AUF-2026-099','AUF-2026-100','AUF-2026-101','AUF-2026-1000','ALT-7']) with ordinality listed(number,position));
  result jsonb;
begin
  result := public.search_planning_options('75000000-0000-4000-8000-000000000010','jobs','Naturnummer',0);
  if (select jsonb_agg(option->'value') from jsonb_array_elements(result->'options') option) IS DISTINCT FROM expected then raise exception 'job choices do not sort naturally'; end if;
  if exists(select 1 from jsonb_array_elements(result->'options') option where option ?| array['record_number','number_unmatched','number_prefix','number_year','number_sequence']) then raise exception 'job choices expose their sort keys'; end if;
  result := public.search_planning_options('75000000-0000-4000-8000-000000000010','jobs','Naturnummer',3);
  if result#>>'{options,0,value}' IS DISTINCT FROM md5('natural-option-AUF-2026-101')::uuid::text then raise exception 'job choices lose the natural order behind an offset'; end if;
end $$;
rollback;
