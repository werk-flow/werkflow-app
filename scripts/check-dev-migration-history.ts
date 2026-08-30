import { assertDevMigrationHistoryParity } from '../lib/testing/dev-migration-history';
import { loadEnvLocal } from '../tests/golden/support/env';

async function main(): Promise<void> {
  try {
    loadEnvLocal();
    await assertDevMigrationHistoryParity();
    console.log(
      '[migrations:check] DEV history matches committed migration versions.',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.main) void main();
