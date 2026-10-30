import { resolve } from 'node:path';

import { supabaseProjectRefs } from '../lib/security/production-access';
import {
  CATALOG_QUERY,
  InspectionFailure,
  LEDGER_QUERY,
  catalogDrift,
  catalogRowsSchema,
  failureMessage,
  ledgerFindings,
  ledgerRowsSchema,
  readProject,
} from '../lib/security/production-inspection';
import { advisorProblems, advisorResponseSchema } from '../lib/security/supabase-project-checks';
import { committedMigrationVersions } from '../lib/testing/local-stack/dev-migration-history';
import { loadEnvLocal } from '../tests/golden/support/env';

/**
 * `bun run prod:inspect`: the one way an agent inspects PROD. It prints the
 * pending migration versions, the names of objects that differ from DEV, and
 * the advisor findings outside the reviewed exceptions. It reads through the
 * Management API's read-only query endpoint with the owner's token, and never
 * prints a table row, a definition, a configuration value or a response body.
 * Exit 1 means a problem or an unverified check.
 */
const label = '[prod:inspect]';
const repositoryRoot = resolve(import.meta.dir, '..');

async function main(): Promise<void> {
  try {
    loadEnvLocal();
    const refs = supabaseProjectRefs(repositoryRoot);
    if (!refs) throw new InspectionFailure('docs/technical/environments.md names no Supabase project refs.');
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new InspectionFailure('SUPABASE_ACCESS_TOKEN is not set (expected in .env.local).');
    const query = 'database/query/read-only';
    const [prodLedger, devLedger, prodCatalog, devCatalog, security, performance] = await Promise.all([
      readProject({
        ref: refs.production,
        path: query,
        token,
        query: LEDGER_QUERY,
        schema: ledgerRowsSchema,
      }),
      readProject({ ref: refs.dev, path: query, token, query: LEDGER_QUERY, schema: ledgerRowsSchema }),
      readProject({
        ref: refs.production,
        path: query,
        token,
        query: CATALOG_QUERY,
        schema: catalogRowsSchema,
      }),
      readProject({ ref: refs.dev, path: query, token, query: CATALOG_QUERY, schema: catalogRowsSchema }),
      readProject({ ref: refs.production, path: 'advisors/security', token, schema: advisorResponseSchema }),
      readProject({
        ref: refs.production,
        path: 'advisors/performance',
        token,
        schema: advisorResponseSchema,
      }),
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
    console.error(`${label} unverified: ${failureMessage(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) void main();
