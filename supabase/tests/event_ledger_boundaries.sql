-- Older event ledgers: privileged edits fail, existing FK cleanup still works.
begin;

do $$
declare ledger text;
begin
  foreach ledger in array array[
    'attention_events', 'client_communication_preference_events', 'client_follow_up_events',
    'client_request_events', 'document_audit_events', 'employee_record_events',
    'organization_responsibility_events', 'qualification_events', 'sickness_report_events',
    'team_events', 'vacation_request_events'
  ] loop
    if not exists (
      select 1 from pg_trigger where tgrelid = ('public.' || ledger)::regclass
        and tgfoid = 'app_private.guard_event_ledger_history()'::regprocedure
        and not tgisinternal and tgenabled in ('O', 'A') and tgtype::integer & 27 = 27
    ) then raise exception 'missing event-history guard on %', ledger; end if;
  end loop;
end;
$$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('73000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
 'ledger-owner@example.test', '', now(), '{}', '{"first_name":"Ledger","last_name":"Owner"}', now(), now()),
('73000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
 'ledger-actor@example.test', '', now(), '{}', '{"first_name":"Ledger","last_name":"Actor"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('73000000-0000-4000-8000-000000000010', 'Event ledger SQL', '73000000-0000-4000-8000-000000000001', 'LEDGERSQL');
insert into public.organization_members (organization_id, user_id, role) values
('73000000-0000-4000-8000-000000000010', '73000000-0000-4000-8000-000000000002', 'employee');
insert into public.client_requests (id, organization_id, summary) values
('73000000-0000-4000-8000-000000000090', '73000000-0000-4000-8000-000000000010', 'Ledger attention source');
insert into public.document_folders (id, organization_id, name, created_by) values
('73000000-0000-4000-8000-000000000020', '73000000-0000-4000-8000-000000000010', 'Ledger folder', '73000000-0000-4000-8000-000000000001');
insert into public.documents (id, organization_id, folder_id, storage_path, original_file_name, display_name, size_bytes, uploaded_by) values
('73000000-0000-4000-8000-000000000021', '73000000-0000-4000-8000-000000000010', '73000000-0000-4000-8000-000000000020',
 '73000000-0000-4000-8000-000000000010/event-ledger-boundary/fixture.txt', 'fixture.txt', 'Fixture', 1, '73000000-0000-4000-8000-000000000001');
insert into public.employee_records (id, organization_id, first_name, last_name) values
('73000000-0000-4000-8000-000000000022', '73000000-0000-4000-8000-000000000010', 'Ledger', 'Employee');
insert into public.document_audit_events (id, organization_id, document_id, folder_id, actor_id, event_type, event_payload) values
('73000000-0000-4000-8000-000000000030', '73000000-0000-4000-8000-000000000010', '73000000-0000-4000-8000-000000000021',
 '73000000-0000-4000-8000-000000000020', '73000000-0000-4000-8000-000000000002', 'uploaded', '{"kept":true}');
insert into public.employee_record_events (id, organization_id, employee_record_id, created_by, event_type, event_payload) values
('73000000-0000-4000-8000-000000000031', '73000000-0000-4000-8000-000000000010', '73000000-0000-4000-8000-000000000022',
 '73000000-0000-4000-8000-000000000002', 'created', '{"kept":true}');
insert into public.attention_events (id, organization_id, user_id, source_type, source_id, event_type, event_payload) values
('73000000-0000-4000-8000-000000000032', '73000000-0000-4000-8000-000000000010', '73000000-0000-4000-8000-000000000002',
 'client_request_open', '73000000-0000-4000-8000-000000000090', 'marked_read', '{"kept":true}');

set local role service_role;
do $$
declare ledger text;
begin
  foreach ledger in array array['document_audit_events', 'employee_record_events', 'attention_events'] loop
    begin
      execute format('update public.%I set event_payload = ''{"tampered":true}''::jsonb
        where organization_id = ''73000000-0000-4000-8000-000000000010''', ledger);
      raise exception 'privileged UPDATE succeeded on %', ledger;
    exception when raise_exception then
      if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
    end;
    begin
      execute format('delete from public.%I where organization_id = ''73000000-0000-4000-8000-000000000010''', ledger);
      raise exception 'privileged DELETE succeeded on %', ledger;
    exception when raise_exception then
      if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
    end;
  end loop;
  begin
    update public.document_audit_events set actor_id = null where id = '73000000-0000-4000-8000-000000000030';
    raise exception 'direct FK nulling succeeded';
  exception when raise_exception then
    if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
  end;
end;
$$;
reset role;

-- Even a nested update with a genuinely deleted FK parent cannot rewrite the
-- payload. This test trigger runs before PostgreSQL's RI SET NULL trigger.
create function pg_temp.attempt_nested_history_edit() returns trigger language plpgsql as $$
begin
  update public.document_audit_events set document_id = null, event_payload = '{"tampered":true}'
    where document_id = old.id;
  return old;
end;
$$;
create trigger "AA_test_nested_history_edit" after delete on public.documents
  for each row execute function pg_temp.attempt_nested_history_edit();
do $$
begin
  begin
    delete from public.documents where id = '73000000-0000-4000-8000-000000000021';
    raise exception 'nested payload update succeeded';
  exception when raise_exception then
    if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
  end;
end;
$$;
drop trigger "AA_test_nested_history_edit" on public.documents;

-- Real parent deletion keeps the history payload and nulls only the declared FK.
delete from auth.users where id = '73000000-0000-4000-8000-000000000002';
delete from public.documents where id = '73000000-0000-4000-8000-000000000021';
delete from public.document_folders where id = '73000000-0000-4000-8000-000000000020';
do $$
begin
  if not exists (select 1 from public.document_audit_events
    where id = '73000000-0000-4000-8000-000000000030' and actor_id is null
      and document_id is null and folder_id is null and event_payload = '{"kept":true}') then
    raise exception 'document SET NULL cleanup changed or removed history';
  end if;
  if not exists (select 1 from public.employee_record_events
    where id = '73000000-0000-4000-8000-000000000031' and created_by is null and event_payload = '{"kept":true}') then
    raise exception 'employee actor SET NULL cleanup changed or removed history';
  end if;
  if exists (select 1 from public.attention_events where id = '73000000-0000-4000-8000-000000000032') then
    raise exception 'attention user cascade did not delete its owned event';
  end if;
end;
$$;
delete from public.employee_records where id = '73000000-0000-4000-8000-000000000022';
delete from public.organizations where id = '73000000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.employee_record_events where id = '73000000-0000-4000-8000-000000000031')
    or exists (select 1 from public.document_audit_events where id = '73000000-0000-4000-8000-000000000030') then
    raise exception 'existing parent and organization cascades were blocked';
  end if;
end;
$$;
rollback;
