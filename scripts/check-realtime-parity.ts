// Realtime parity check (Stage B, enforcement-ladder Tier 2): diffs the
// provider's table list (lib/realtime/tables.ts) against the LOCAL stack's
// actual publication and replica-identity state. Catches:
// - a table in the app list that the supabase_realtime publication misses
//   (its events silently never arrive), and the reverse,
// - replica identity drift: published org tables must use the minimal
//   (id, organization_id) index — FULL leaks deleted rows past RLS, and a
//   dropped replident index silently degrades the table to NOTHING, which
//   makes UPDATE/DELETE on it fail outright.
// Runs against the local stack via docker exec (schema == committed
// migrations after every reset; the canary's migration-parity test keeps
// cloud DEV honest). Invoked by the local preflight and available directly:
//   bun run realtime:check
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_IDENTITY_REALTIME_TABLES,
  REALTIME_TABLES,
  UNFILTERED_REALTIME_TABLES,
} from '../lib/realtime/tables';

const DEFAULT_IDENTITY_TABLES = new Set<string>(DEFAULT_IDENTITY_REALTIME_TABLES);

const QUERY = `
select coalesce(json_agg(row_to_json(state)), '[]'::json) from (
  select
    pt.tablename,
    c.relreplident::text as replident,
    coalesce((
      select i.indexrelid::regclass::text
      from pg_index i
      where i.indrelid = c.oid and i.indisreplident
    ), '') as replident_index
  from pg_publication_tables pt
  join pg_namespace n on n.nspname = pt.schemaname
  join pg_class c on c.relname = pt.tablename and c.relnamespace = n.oid
  where pt.pubname = 'supabase_realtime'
    and pt.schemaname = 'public'
) state`;

type PublishedTableState = {
  tablename: string;
  replident: string;
  replident_index: string;
};

function readPublishedState(): PublishedTableState[] {
  const raw = execFileSync(
    'wsl',
    [
      'docker',
      'exec',
      'supabase_db_werkflow-app',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-tA',
      '-c',
      QUERY,
    ],
    { encoding: 'utf8', timeout: 30_000 }
  ).trim();
  if (!raw) throw new Error('No response from the local stack.');
  return JSON.parse(raw) as PublishedTableState[];
}

export function checkRealtimeParity(): string[] {
  const published = readPublishedState();
  const publishedNames = new Set(published.map((row) => row.tablename));
  const expectedNames = new Set<string>(REALTIME_TABLES);
  const problems: string[] = [];

  for (const table of REALTIME_TABLES) {
    if (!publishedNames.has(table)) {
      problems.push(
        `${table}: in the provider list but NOT in the supabase_realtime publication — its events never arrive.`
      );
    }
  }
  for (const row of published) {
    if (!expectedNames.has(row.tablename)) {
      problems.push(
        `${row.tablename}: published but missing from lib/realtime/tables.ts — either subscribe it or drop it from the publication.`
      );
    }
  }

  for (const row of published) {
    if (DEFAULT_IDENTITY_TABLES.has(row.tablename)) {
      if (row.replident !== 'd') {
        problems.push(
          `${row.tablename}: expected DEFAULT replica identity (primary key is already minimal), found '${row.replident}'.`
        );
      }
      continue;
    }
    if (row.replident !== 'i') {
      problems.push(
        `${row.tablename}: expected replica identity USING INDEX (minimal DELETE payload), found '${row.replident}'. FULL leaks deleted rows past RLS; NOTHING breaks UPDATE/DELETE on published tables.`
      );
      continue;
    }
    if (!row.replident_index.endsWith('_replident_idx')) {
      problems.push(
        `${row.tablename}: replica identity index is '${row.replident_index}', expected the committed *_replident_idx (id, organization_id) index.`
      );
    }
  }

  const unfiltered = new Set<string>(UNFILTERED_REALTIME_TABLES);
  for (const table of unfiltered) {
    if (!expectedNames.has(table)) {
      problems.push(
        `${table}: listed as an unfiltered exception but not in REALTIME_TABLES.`
      );
    }
  }

  return problems;
}

if (import.meta.main) {
  try {
    const problems = checkRealtimeParity();
    if (problems.length > 0) {
      console.error('[realtime:check] FAILED:');
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log(
      `[realtime:check] OK — ${REALTIME_TABLES.length} tables published with the expected replica identities.`
    );
  } catch (error) {
    console.error('[realtime:check] could not inspect the local stack:', error);
    process.exit(1);
  }
}
