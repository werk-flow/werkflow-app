// Tier 2: local publication identity, deletion-trigger coverage, and operation
// flags must match the provider. Raw DELETE/TRUNCATE bypass Realtime RLS.
import { execFileSync } from 'node:child_process';
import { REALTIME_PUBLISHED_TABLES } from '../lib/realtime/tables';
import {
  validateRealtimePublication,
  type PublishedTableState,
  type PublicationFlags,
} from '../lib/realtime/publication-contract';

// Exported for provider metadata checks; the SQL reads catalogs only.
export const REALTIME_STATE_QUERY = `
select coalesce(json_agg(row_to_json(state)), '[]'::json) from (
  select pt.schemaname, pt.tablename, c.relreplident::text as replident,
    coalesce((select i.indexrelid::regclass::text from pg_index i
      where i.indrelid=c.oid and i.indisreplident), '') as replident_index,
    coalesce((select string_agg(a.attname, ',' order by k.ordinality)
      from pg_index i
      cross join lateral unnest(i.indkey) with ordinality as k(attnum,ordinality)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
      where i.indrelid=c.oid and i.indisreplident), '') as replident_index_columns,
    exists(select 1 from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal
      and t.tgname='emit_realtime_deletion' and t.tgenabled='O' and t.tgtype=9
      and t.tgfoid=to_regprocedure('app_private.emit_realtime_deletion()')) as deletion_trigger_valid,
    (exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attname='updated_at' and pg_get_expr(d.adbin, d.adrelid)='now()')
    and exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid=c.oid and not t.tgisinternal and t.tgenabled='O'
      and (t.tgtype & 1)=1 and (t.tgtype & 2)=2 and (t.tgtype & 16)=16
      and p.prosrc ~* 'new[.]updated_at[[:space:]]*:?=[[:space:]]*now[(][)]')) as transaction_stamp_valid
  from pg_publication_tables pt
  join pg_namespace n on n.nspname=pt.schemaname
  join pg_class c on c.relname=pt.tablename and c.relnamespace=n.oid
  where pt.pubname='supabase_realtime'
) state`;

export const REALTIME_PUBLICATION_QUERY = `
select coalesce(json_agg(row_to_json(p)), '[]'::json) from (
  select pubinsert,pubupdate,pubdelete,pubtruncate
  from pg_publication where pubname='supabase_realtime'
) p`;

function runLocalQuery<T>(query: string): T {
  const args = [
    'exec',
    'supabase_db_werkflow-app',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-tA',
    '-c',
    query,
  ];
  const [executable, arguments_]: [string, string[]] =
    process.platform === 'win32' ? ['wsl', ['docker', ...args]] : ['docker', args];
  const raw = execFileSync(executable, arguments_, { encoding: 'utf8', timeout: 30_000 }).trim();
  if (!raw) throw new Error('No response from the local stack.');
  return JSON.parse(raw) as T;
}

export function checkRealtimeParity(): string[] {
  return validateRealtimePublication(
    runLocalQuery<PublishedTableState[]>(REALTIME_STATE_QUERY),
    runLocalQuery<PublicationFlags[]>(REALTIME_PUBLICATION_QUERY),
  );
}

if (import.meta.main) {
  try {
    const problems = checkRealtimeParity();
    if (problems.length) {
      console.error('[realtime:check] FAILED:');
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
    } else
      console.log(
        `[realtime:check] OK — ${REALTIME_PUBLISHED_TABLES.length} tables; authorized deletion transport and minimal identities.`,
      );
  } catch (error) {
    console.error('[realtime:check] could not inspect the local stack:', error);
    process.exitCode = 1;
  }
}
