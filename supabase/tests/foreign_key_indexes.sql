-- Every foreign key in public has an index its referential check can use.
-- Deleting or re-keying a parent row runs one lookup per referencing key; with
-- no usable index that lookup scans the whole child table, once per parent
-- row. An organization's deletion then outran the 8 s statement timeout.
-- Usable: a valid index whose leading columns are exactly the key's columns,
-- in any order, and whose predicate, if any, only requires key columns to be
-- not null (the lookup's `column = $1` implies that).
begin;

do $$
declare
  foreign_key record;
  missing text[] := '{}';
begin
  for foreign_key in
    select constraint_row.conrelid::regclass::text as table_name, constraint_row.conname,
      constraint_row.conrelid, constraint_row.conkey,
      array(select attribute.attname::text from unnest(constraint_row.conkey) key_column(number)
        join pg_attribute attribute on attribute.attrelid = constraint_row.conrelid
          and attribute.attnum = key_column.number) as key_columns
    from pg_constraint constraint_row
    join pg_namespace namespace on namespace.oid = constraint_row.connamespace
    where constraint_row.contype = 'f' and namespace.nspname = 'public'
  loop
    if not exists (
      select 1 from pg_index index_row
      where index_row.indrelid = foreign_key.conrelid and index_row.indisvalid
        and (index_row.indkey::int2[])[0:cardinality(foreign_key.conkey) - 1] @> foreign_key.conkey
        and (index_row.indkey::int2[])[0:cardinality(foreign_key.conkey) - 1] <@ foreign_key.conkey
        and (
          index_row.indpred is null
          or regexp_replace(
            pg_get_expr(index_row.indpred, index_row.indrelid),
            '\m(' || array_to_string(foreign_key.key_columns, '|') || ') IS NOT NULL\M|AND|[()[:space:]]',
            '', 'g'
          ) = ''
        )
    ) then
      missing := missing || format('%s.%s (%s)', foreign_key.table_name, foreign_key.conname,
        array_to_string(foreign_key.key_columns, ', '));
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'foreign_key_without_index: %', array_to_string(missing, '; ');
  end if;
end;
$$;

rollback;
