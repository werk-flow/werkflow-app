import { resolve } from 'node:path';

import { supabaseProjectRefs } from '../lib/security/production-access';
import {
  CATALOG_QUERY,
  LEDGER_QUERY,
  catalogDrift,
  catalogRowsSchema,
  ledgerFindings,
  ledgerRowsSchema,
} from '../lib/security/production-inspection';
import { advisorProblems, advisorResponseSchema } from '../lib/security/supabase-project-checks';
import { committedMigrationVersions } from '../lib/testing/local-stack/dev-migration-history';
import { loadEnvLocal, requireEnv } from '../tests/golden/support/env';

/**
 * `bun run prod:inspect`: the one way an agent inspects PROD. It prints the
 * pending migration versions, the names of objects that differ from DEV, and
 * the advisor findings outside the reviewed exceptions. It reads through the
 * Management API's read-only query endpoint with the owner's token, and never
 * prints a table row, a definition or a configuration value. Exit 1 means a
 * problem or an unverified check.
 */
const label = '[prod:inspect]';
const repositoryRoot = resolve(import.meta.dir, '..');

async function request(ref: string, path: string, query?: string): Promise<unknown> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`, {
    method: query === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('SUPABASE_ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: query === undefined ? null : JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
  return response.json();
}

const readOnlyQuery = (ref: string, query: string) => request(ref, 'database/query/read-only', query);

async function main(): Promise<void> {
  try {
    loadEnvLocal();
    const refs = supabaseProjectRefs(repositoryRoot);
    if (!refs) throw new Error('docs/technical/environments.md names no Supabase project refs.');
    const [prodLedger, devLedger, prodCatalog, devCatalog, security, performance] = await Promise.all([
      readOnlyQuery(refs.production, LEDGER_QUERY).then((rows) => ledgerRowsSchema.parse(rows)),
      readOnlyQuery(refs.dev, LEDGER_QUERY).then((rows) => ledgerRowsSchema.parse(rows)),
      readOnlyQuery(refs.production, CATALOG_QUERY).then((rows) => catalogRowsSchema.parse(rows)),
      readOnlyQuery(refs.dev, CATALOG_QUERY).then((rows) => catalogRowsSchema.parse(rows)),
      request(refs.production, 'advisors/security').then((body) => advisorResponseSchema.parse(body)),
      request(refs.production, 'advisors/performance').then((body) => advisorResponseSchema.parse(body)),
    ]);

    const ledger = ledgerFindings({
      committed: committedMigrationVersions(repositoryRoot),
      prod: prodLedger.map((row) => row.version),
      dev: devLedger.map((row) => row.version),
    });
    console.log(
      `${label} Migration ledger: ${ledger.pending.length === 0 ? 'PROD holds every committed version.' : `pending release: ${ledger.pending.join(', ')}.`}`,
    );

    const drift = catalogDrift(devCatalog, prodCatalog);
    const driftProblems = ledger.matchesDev ? drift : [];
    if (drift.length === 0) console.log(`${label} Schema: PROD matches DEV.`);
    else {
      console.log(
        `${label} Schema: ${drift.length} objects differ from DEV${ledger.matchesDev ? ', with identical migration ledgers' : ', expected while DEV holds migrations PROD lacks'}:`,
      );
      for (const line of drift) console.log(`  ${line}`);
    }

    const advisors = advisorProblems([...security.lints, ...performance.lints]);
    console.log(
      `${label} Advisors: ${advisors.length === 0 ? 'no finding outside the reviewed exceptions.' : `${advisors.length} findings.`}`,
    );
    for (const line of advisors) console.log(`  ${line}`);

    const problems = [...ledger.problems, ...driftProblems, ...advisors];
    for (const problem of ledger.problems) console.error(`${label} ${problem}`);
    console.log(
      `${label} PROD ${problems.length === 0 ? 'has no problem' : `has ${problems.length} problems`}.`,
    );
    process.exitCode = problems.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`${label} unverified: ${error instanceof Error ? error.message : 'request failed'}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) void main();
