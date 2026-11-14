-- Who reads a document linked to an Anlage through the Data API
-- (docs/technical/document-storage-and-access.md, "Access";
-- werk-flow/werkflow-planning#468). Runs inside one transaction against the
-- local stack and rolls back.
--
-- The employee assigned to a job reads an ordinary document linked to an
-- Anlage of that job. A colleague who is not assigned, the same employee once
-- the assignment ends, and another organization's members read nothing. A
-- financial paper, a document with an office-only link and a voided Anlage stay
-- closed to the employee; Admin and Büro read every one.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('ef000000-0000-4000-8000-00000000000' || person.n)::uuid, '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'efd-' || person.n || '@example.test', '', now(), '{}',
  json_build_object('first_name', person.first_name, 'last_name', 'Musterfrau')::text::jsonb, now(), now()
from (values ('1', 'Admin'), ('2', 'Buero'), ('3', 'Erika'), ('4', 'Max'), ('5', 'Fremd'), ('6', 'Fremdkraft'))
  as person(n, first_name);

set local role service_role;

insert into public.organizations (id, name, admin_id, unique_code) values
('ef000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH', 'ef000000-0000-4000-8000-000000000001', 'EFDSQL01'),
('ef000000-0000-4000-8000-000000000011', 'Fremdbetrieb GmbH', 'ef000000-0000-4000-8000-000000000005', 'EFDSQL02');

-- Creating an organization makes its admin a member.
insert into public.organization_members (organization_id, user_id, role) values
('ef000000-0000-4000-8000-000000000010', 'ef000000-0000-4000-8000-000000000002', 'buero'),
('ef000000-0000-4000-8000-000000000010', 'ef000000-0000-4000-8000-000000000003', 'employee'),
('ef000000-0000-4000-8000-000000000010', 'ef000000-0000-4000-8000-000000000004', 'employee'),
('ef000000-0000-4000-8000-000000000011', 'ef000000-0000-4000-8000-000000000006', 'employee');

-- Erika works the maintenance job; Max works another job. The foreign
-- employee works a job of the other organization.
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('ef000000-0000-4000-8000-000000000030', 'ef000000-0000-4000-8000-000000000010', 'Wartung Heizung',
 'EFD-1', 'ef000000-0000-4000-8000-000000000001'),
('ef000000-0000-4000-8000-000000000031', 'ef000000-0000-4000-8000-000000000010', 'Bad Umbau',
 'EFD-2', 'ef000000-0000-4000-8000-000000000001'),
('ef000000-0000-4000-8000-000000000032', 'ef000000-0000-4000-8000-000000000011', 'Fremder Auftrag',
 'EFD-3', 'ef000000-0000-4000-8000-000000000005');
insert into public.job_assignments (job_id, user_id, assigned_by) values
('ef000000-0000-4000-8000-000000000030', 'ef000000-0000-4000-8000-000000000003', 'ef000000-0000-4000-8000-000000000001'),
('ef000000-0000-4000-8000-000000000031', 'ef000000-0000-4000-8000-000000000004', 'ef000000-0000-4000-8000-000000000001'),
('ef000000-0000-4000-8000-000000000032', 'ef000000-0000-4000-8000-000000000006', 'ef000000-0000-4000-8000-000000000005');

reset role;
set local session_replication_role = replica;
-- Anlage 40 is on Erika's job. Anlage 41, a Nachfolger of 40 voided by a
-- correction, is on it too. The
-- other organization forges a work link from its job to Anlage 40.
insert into public.installed_equipment (
  id, organization_id, client_id, site_id, equipment_number, name, category, state, created_by, updated_by,
  predecessor_equipment_id, voided_at, voided_by, void_reason
) values
('ef000000-0000-4000-8000-000000000040', 'ef000000-0000-4000-8000-000000000010',
 'ef000000-0000-4000-8000-000000000020', 'ef000000-0000-4000-8000-000000000021', 'EFD-ANL-1', 'Gasbrennwertkessel',
 'heat_generation', 'active', 'ef000000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000001',
 null, null, null, null),
('ef000000-0000-4000-8000-000000000041', 'ef000000-0000-4000-8000-000000000010',
 'ef000000-0000-4000-8000-000000000020', 'ef000000-0000-4000-8000-000000000021', 'EFD-ANL-2', 'Speicher',
 'heat_generation', 'active', 'ef000000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000001',
 'ef000000-0000-4000-8000-000000000040', now(), 'ef000000-0000-4000-8000-000000000001', 'Falsch erfasst');
insert into public.installed_equipment_work_links (organization_id, equipment_id, job_id, created_by) values
('ef000000-0000-4000-8000-000000000010', 'ef000000-0000-4000-8000-000000000040',
 'ef000000-0000-4000-8000-000000000030', 'ef000000-0000-4000-8000-000000000001'),
('ef000000-0000-4000-8000-000000000010', 'ef000000-0000-4000-8000-000000000041',
 'ef000000-0000-4000-8000-000000000030', 'ef000000-0000-4000-8000-000000000001'),
('ef000000-0000-4000-8000-000000000011', 'ef000000-0000-4000-8000-000000000040',
 'ef000000-0000-4000-8000-000000000032', 'ef000000-0000-4000-8000-000000000005');

-- Documents on Anlage 40: a manual (ordinary), a contract (financial), a
-- report with a retention class (financial), a manual also linked to a
-- maintenance coverage (office-only); and a manual on the voided Anlage 41.
insert into public.documents (
  id, organization_id, display_name, original_file_name, storage_path, size_bytes, category,
  current_version_number, uploaded_by, retention_class
)
select ('ef000000-0000-4000-8000-00000000006' || doc.n)::uuid, 'ef000000-0000-4000-8000-000000000010',
  doc.name, doc.name, 'ef000000-0000-4000-8000-000000000010/efd-' || doc.n || '.pdf', 42, doc.category, 1,
  'ef000000-0000-4000-8000-000000000001', doc.retention::public.document_retention_class
from (values
  ('0', 'Bedienungsanleitung.pdf', 'other', null),
  ('1', 'Wartungsvertrag.pdf', 'contract', null),
  ('2', 'Pruefbericht.pdf', 'report', 'ten_years'),
  ('3', 'Vertragsanlage.pdf', 'other', null),
  ('4', 'Speicher-Anleitung.pdf', 'other', null)
) as doc(n, name, category, retention);
insert into public.document_links (organization_id, document_id, equipment_id, maintenance_coverage_id, created_by)
select 'ef000000-0000-4000-8000-000000000010', ('ef000000-0000-4000-8000-00000000006' || link.n)::uuid,
  link.equipment::uuid, link.coverage::uuid, 'ef000000-0000-4000-8000-000000000001'
from (values
  ('0', 'ef000000-0000-4000-8000-000000000040', null),
  ('1', 'ef000000-0000-4000-8000-000000000040', null),
  ('2', 'ef000000-0000-4000-8000-000000000040', null),
  ('3', 'ef000000-0000-4000-8000-000000000040', null),
  ('3', null, 'ef000000-0000-4000-8000-000000000050'),
  ('4', 'ef000000-0000-4000-8000-000000000041', null)
) as link(n, equipment, coverage);
set local session_replication_role = origin;

create function pg_temp.visible_equipment_documents() returns text language sql as $$
  select coalesce(string_agg(display_name, ',' order by display_name), '')
  from public.documents
  where storage_path like 'ef000000-0000-4000-8000-000000000010/efd-%';
$$;
grant execute on function pg_temp.visible_equipment_documents() to authenticated;

create function pg_temp.expect_documents(p_user uuid, p_expected text, p_case text) returns void
language plpgsql as $$
declare actual text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  actual := pg_temp.visible_equipment_documents();
  execute 'reset role';
  if actual is distinct from p_expected then
    raise exception '%: % reads "%", expected "%"', p_case, p_user, actual, p_expected;
  end if;
end;
$$;

select pg_temp.expect_documents('ef000000-0000-4000-8000-000000000001',
  'Bedienungsanleitung.pdf,Pruefbericht.pdf,Speicher-Anleitung.pdf,Vertragsanlage.pdf,Wartungsvertrag.pdf',
  'Admin reads every document of the organization');
select pg_temp.expect_documents('ef000000-0000-4000-8000-000000000002',
  'Bedienungsanleitung.pdf,Pruefbericht.pdf,Speicher-Anleitung.pdf,Vertragsanlage.pdf,Wartungsvertrag.pdf',
  'Büro reads every document of the organization');
select pg_temp.expect_documents('ef000000-0000-4000-8000-000000000003', 'Bedienungsanleitung.pdf',
  'The assigned employee reads only the ordinary manual of the job''s Anlage, no financial paper, '
  || 'no office-only document and nothing of a voided Anlage');
select pg_temp.expect_documents('ef000000-0000-4000-8000-000000000004', '',
  'An employee not assigned to the job reads no document of its Anlage');
select pg_temp.expect_documents('ef000000-0000-4000-8000-000000000005', '',
  'Another organization''s admin reads nothing');
select pg_temp.expect_documents('ef000000-0000-4000-8000-000000000006', '',
  'Another organization''s employee reads nothing through a work link of its own organization');

-- The read ends with the assignment.
set local role service_role;
delete from public.job_assignments
where job_id = 'ef000000-0000-4000-8000-000000000030' and user_id = 'ef000000-0000-4000-8000-000000000003';
reset role;
select pg_temp.expect_documents('ef000000-0000-4000-8000-000000000003', '',
  'The employee reads no manual after the assignment ended');

rollback;
