-- The ledger trigger of the shared local stack (lib/testing/local-stack/stack-sync.ts, GUARD_SQL;
-- docs/technical/environments.md, "The migration rule"): outside the sync's session no INSERT,
-- UPDATE, DELETE or TRUNCATE reaches supabase_migrations.schema_migrations, so a branch's
-- `supabase migration up` rolls back; in the sync's session every one of them passes. The trigger
-- below is GUARD_SQL's, which lib/testing/local-stack/stack-sync.test.ts keeps equal.
-- Runs inside one transaction against the local stack and rolls back.
begin;

create or replace function supabase_migrations.werkflow_main_only() returns trigger
language plpgsql as $guard$
begin
  if current_setting('werkflow.stack_sync', true) = 'main' then
    return coalesce(new, old);
  end if;
  raise exception 'Refused: this local stack is shared by every worktree and takes only main''s migrations, through bun run stack:sync. A branch migration never runs here: bun run types:generate -- --local writes its types and bun run test:verify tests it, and neither changes this database (docs/technical/environments.md, The migration rule).';
end
$guard$;
create or replace trigger werkflow_main_only before insert or update or delete on supabase_migrations.schema_migrations
  for each row execute function supabase_migrations.werkflow_main_only();
create or replace trigger werkflow_main_only_truncate before truncate on supabase_migrations.schema_migrations
  for each statement execute function supabase_migrations.werkflow_main_only();

-- A branch's session, with no setting and with any other value: every kind of write is refused.
create function pg_temp.expect_refused(statement text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when raise_exception then
    if sqlerrm like 'Refused: this local stack is shared by every worktree%' then
      return;
    end if;
    raise;
  end;
  raise exception 'the ledger took a branch write: %', statement;
end;
$$;

do $$
declare
  ledger_rows bigint := (select count(*) from supabase_migrations.schema_migrations);
  oldest text := (select min(version) from supabase_migrations.schema_migrations);
  setting text;
begin
  if ledger_rows = 0 then
    raise exception 'the ledger is empty, so UPDATE and DELETE would prove nothing';
  end if;
  foreach setting in array array['', 'branch'] loop
    perform set_config('werkflow.stack_sync', setting, true);
    perform pg_temp.expect_refused(
      $sql$insert into supabase_migrations.schema_migrations (version, name, statements)
           values ('20991231000000', 'branch_probe', array['select 1'])$sql$);
    perform pg_temp.expect_refused(
      format('update supabase_migrations.schema_migrations set name = name where version = %L', oldest));
    perform pg_temp.expect_refused(
      format('delete from supabase_migrations.schema_migrations where version = %L', oldest));
    perform pg_temp.expect_refused('truncate supabase_migrations.schema_migrations');
  end loop;
  if (select count(*) from supabase_migrations.schema_migrations) is distinct from ledger_rows
    or exists (select 1 from supabase_migrations.schema_migrations where version = '20991231000000') then
    raise exception 'a refused write changed the ledger';
  end if;
end;
$$;

-- The sync's session: every kind of write passes.
set local werkflow.stack_sync = 'main';
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20991231000000', 'main_probe', array['select 1']);
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20991231000000' and name = 'main_probe') then
    raise exception 'the sync''s insert did not reach the ledger';
  end if;
end;
$$;
update supabase_migrations.schema_migrations set name = 'main_probe_renamed' where version = '20991231000000';
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20991231000000' and name = 'main_probe_renamed') then
    raise exception 'the sync''s update did not reach the ledger';
  end if;
end;
$$;
delete from supabase_migrations.schema_migrations where version = '20991231000000';
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20991231000000') then
    raise exception 'the sync''s delete did not reach the ledger';
  end if;
end;
$$;
truncate supabase_migrations.schema_migrations;
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations) then
    raise exception 'the sync''s truncate did not reach the ledger';
  end if;
end;
$$;

rollback;
