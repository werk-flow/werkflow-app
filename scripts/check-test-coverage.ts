import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseCatalogFlows,
  readCoverageMap,
  validateCoverageMap,
} from '../lib/testing/selection/coverage-map';
import {
  getTestGroups,
  listTestFiles,
  validateTestGroupInventory,
} from '../lib/testing/selection/test-groups';

const root = resolve(import.meta.dir, '..');
try {
  const groups = getTestGroups(root);
  const catalog = parseCatalogFlows(readFileSync(resolve(root, 'docs/product/user-flow-catalog.md'), 'utf8'));
  const coverage = readCoverageMap(root);
  const discovered = [
    ...listTestFiles(root, 'tests', /\.spec\.ts$/),
    ...listTestFiles(root, 'lib', /\.test\.(?:ts|tsx|mjs)$/),
    ...listTestFiles(root, 'supabase/tests', /\.sql$/),
  ];
  const problems = [
    ...validateTestGroupInventory(groups, discovered),
    ...groups.flatMap((group) =>
      group.files
        .filter((file) => !existsSync(resolve(root, file)))
        .map((file) => `Missing group file: ${file}`),
    ),
    ...validateCoverageMap({ catalog, coverage, groups, repositoryRoot: root }),
  ];
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      `Coverage traceability passed: ${catalog.length} catalog flows, ${coverage.mappings.length} many-to-many mappings, ${groups.length} execution groups. Whole-clause semantic review remains required; this check does not certify runtime outcomes.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
