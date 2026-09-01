-- Cover every P1-23 foreign key with a leading-column index. The hash suffix
-- keeps generated names distinct within PostgreSQL's 63-byte identifier limit.
do $$
declare
  foreign_key record;
  column_list text;
  index_name text;
begin
  for foreign_key in
    select constraint_row.oid, constraint_row.conrelid, constraint_row.conname,
      table_row.relname
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class table_row on table_row.oid = constraint_row.conrelid
    where constraint_row.contype = 'f'
      and table_row.relnamespace = 'public'::regnamespace
      and table_row.relname ~ '^(time_account|time_period|payroll_)'
  loop
    select string_agg(pg_catalog.quote_ident(attribute_row.attname), ', ' order by key_column.ordinality)
      into column_list
    from unnest((select conkey from pg_catalog.pg_constraint where oid = foreign_key.oid))
      with ordinality as key_column(attnum, ordinality)
    join pg_catalog.pg_attribute attribute_row
      on attribute_row.attrelid = foreign_key.conrelid
      and attribute_row.attnum = key_column.attnum;

    index_name := left(foreign_key.relname, 42) || '_fk_' ||
      substr(md5(foreign_key.conname), 1, 8);
    execute format(
      'create index if not exists %I on public.%I (%s)',
      index_name,
      foreign_key.relname,
      column_list
    );
  end loop;
end;
$$;

-- The composite organization identity indexes already exist as unique
-- constraint indexes. Reuse those instead of retaining identical copies.
alter table public.time_account_policies
  replica identity using index time_account_policies_id_org_unique;
alter table public.time_accounts
  replica identity using index time_accounts_id_org_unique;
alter table public.time_account_adjustment_requests
  replica identity using index time_account_adjustment_requests_id_org_unique;
alter table public.time_periods
  replica identity using index time_periods_id_org_unique;
alter table public.payroll_mapping_profiles
  replica identity using index payroll_mapping_profiles_id_org_unique;
alter table public.payroll_exports
  replica identity using index payroll_exports_id_org_unique;

drop index public.time_account_policies_replident_idx;
drop index public.time_accounts_replident_idx;
drop index public.time_account_adjustment_requests_replident_idx;
drop index public.time_periods_replident_idx;
drop index public.payroll_mapping_profiles_replident_idx;
drop index public.payroll_exports_replident_idx;
