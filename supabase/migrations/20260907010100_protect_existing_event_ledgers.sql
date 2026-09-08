-- Preserve each ledger's existing FK retention behavior while preventing
-- direct privileged edits. An unrelated nested trigger is not a bypass.
create function app_private.guard_event_ledger_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  foreign_key record;
  old_payload jsonb := to_jsonb(old);
  new_payload jsonb;
  parent_exists boolean;
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'UPDATE' then new_payload := to_jsonb(new); end if;
    for foreign_key in
      select constraint_row.confrelid, constraint_row.confdeltype,
        array_agg(child_column.attname::text order by key_column.ordinality) as child_columns,
        jsonb_object_agg(parent_column.attname, old_payload -> child_column.attname) as parent_key,
        bool_and(old_payload -> child_column.attname <> 'null'::jsonb) as has_parent_key,
        string_agg(format('parent.%I is not distinct from expected.%I', parent_column.attname,
          parent_column.attname), ' and ' order by key_column.ordinality) as parent_match
      from pg_catalog.pg_constraint constraint_row
      cross join lateral unnest(constraint_row.conkey, constraint_row.confkey)
        with ordinality as key_column(child_number, parent_number, ordinality)
      join pg_catalog.pg_attribute child_column on child_column.attrelid = constraint_row.conrelid
        and child_column.attnum = key_column.child_number
      join pg_catalog.pg_attribute parent_column on parent_column.attrelid = constraint_row.confrelid
        and parent_column.attnum = key_column.parent_number
      where constraint_row.conrelid = tg_relid and constraint_row.contype = 'f'
        and ((tg_op = 'DELETE' and constraint_row.confdeltype = 'c')
          or (tg_op = 'UPDATE' and constraint_row.confdeltype = 'n'))
      group by constraint_row.oid, constraint_row.confrelid, constraint_row.confdeltype
    loop
      if not foreign_key.has_parent_key then continue; end if;
      if tg_op = 'UPDATE' and (
        old_payload - foreign_key.child_columns is distinct from new_payload - foreign_key.child_columns
        or exists (select 1 from unnest(foreign_key.child_columns) column_name
          where new_payload -> column_name is distinct from 'null'::jsonb)
      ) then continue; end if;

      execute format('select exists (select 1 from %s parent, jsonb_populate_record(null::%s, $1) expected where %s)',
        foreign_key.confrelid::regclass, foreign_key.confrelid::regclass, foreign_key.parent_match)
        into parent_exists using foreign_key.parent_key;
      if not parent_exists then
        if tg_op = 'DELETE' then return old; else return new; end if;
      end if;
    end loop;
  end if;
  raise exception 'event_ledger_history_immutable';
end;
$$;

revoke all on function app_private.guard_event_ledger_history() from public, anon, authenticated;

do $$
declare ledger text;
begin
  foreach ledger in array array[
    'attention_events', 'client_communication_preference_events', 'client_follow_up_events',
    'client_request_events', 'document_audit_events', 'employee_record_events',
    'organization_responsibility_events', 'qualification_events', 'sickness_report_events',
    'team_events', 'vacation_request_events'
  ] loop
    execute format('create trigger guard_event_ledger_history before update or delete on public.%I
      for each row execute function app_private.guard_event_ledger_history()', ledger);
  end loop;
end;
$$;
