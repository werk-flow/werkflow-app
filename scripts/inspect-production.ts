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
  PROD_DENIED,
  ledgerRowsSchema,
  projectTokens,
  readProject,
} from '../lib/security/production-inspection';
import { advisorProblems, advisorResponseSchema } from '../lib/security/supabase-project-checks';
import { committedMigrationVersions } from '../lib/testing/local-stack/dev-migration-history';
import { loadEnvLocal } from '../tests/golden/support/env';

/**
 * `bun run prod:inspect`: the one way PROD's structure is inspected. It prints
 * the pending migration versions, the names of objects that differ from DEV,
 * and the advisor findings outside the reviewed exceptions. It reads through
 * the Management API's read-only query endpoint, PROD with the read-only PROD
 * token that only the PROD inspection job holds (.github/workflows/prod-inspect.yml),
 * DEV with SUPABASE_ACCESS_TOKEN (in the job, the DEV-scoped DEV_INSPECT_SUPABASE_TOKEN).
 * It never prints a table row, a definition, an advisor's text, a
 * configuration value or a response body: the job's log is public. On a
 * workstation it fails and names the job. Exit 1 means a problem or an
 * unverified check.
 */
const label = '[prod:inspect]';
const repositoryRoot = resolve(import.meta.dir, '..');

async function main(): Promise<void> {
  try {
    loadEnvLocal();
    const refs = supabaseProjectRefs(repositoryRoot);
    if (!refs) throw new InspectionFailure('docs/technical/environments.md names no Supabase project refs.');
    const tokens = projectTokens(process.env);
    const prod = { ref: refs.production, token: tokens.production, denied: PROD_DENIED };
    const dev = { ref: refs.dev, token: tokens.dev };
    const query = 'database/query/read-only';
    const [prodLedger, devLedger, prodCatalog, devCatalog, security, performance] = await Promise.all([
      readProject({ ...prod, path: query, query: LEDGER_QUERY, schema: ledgerRowsSchema }),
      readProject({ ...dev, path: query, query: LEDGER_QUERY, schema: ledgerRowsSchema }),
      readProject({ ...prod, path: query, query: CATALOG_QUERY, schema: catalogRowsSchema }),
      readProject({ ...dev, path: query, query: CATALOG_QUERY, schema: catalogRowsSchema }),
      readProject({ ...prod, path: 'advisors/security', schema: advisorResponseSchema }),
      readProject({ ...prod, path: 'advisors/performance', schema: advisorResponseSchema }),
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

    const advisors = advisorProblems([...security.lints, ...performance.lints], undefined, { detail: false });
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
