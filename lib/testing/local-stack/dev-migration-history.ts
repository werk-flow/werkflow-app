import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { compareMigrationVersions, migrationVersionFromFileName } from './migration-history';
import { LEDGER_QUERY, ledgerRowsSchema } from '../../security/production-inspection';
import { queryDevReadOnly } from '../../security/dev-management-api';

const DEV_PROJECT_REF = 'mbkkzuqjbdvzelqvuzcn';

export function validateSupabaseCliLink(linkedProjectRef: string | null): string[] {
  if (linkedProjectRef === null || linkedProjectRef === DEV_PROJECT_REF) {
    return [];
  }

  return [
    `Supabase CLI is linked to ${linkedProjectRef}, not DEV ${DEV_PROJECT_REF}. Relink DEV before any CLI migration command.`,
  ];
}

function readLinkedProjectRef(repositoryRoot: string): string | null {
  try {
    return readFileSync(resolve(repositoryRoot, 'supabase/.temp/project-ref'), 'utf8').trim();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function committedMigrationVersions(repositoryRoot = process.cwd()): string[] {
  return readdirSync(resolve(repositoryRoot, 'supabase/migrations'))
    .map(migrationVersionFromFileName)
    .filter((version): version is string => version !== null)
    .sort();
}

async function remoteDevMigrationVersions(): Promise<string[]> {
  return ledgerRowsSchema
    .parse(await queryDevReadOnly('migration-history', LEDGER_QUERY))
    .map((row) => row.version);
}

export async function getDevMigrationHistoryProblems(repositoryRoot = process.cwd()): Promise<string[]> {
  return [
    ...validateSupabaseCliLink(readLinkedProjectRef(repositoryRoot)),
    ...compareMigrationVersions({
      committed: committedMigrationVersions(repositoryRoot),
      remote: await remoteDevMigrationVersions(),
    }),
  ];
}

export async function assertDevMigrationHistoryParity(repositoryRoot = process.cwd()): Promise<void> {
  const problems = await getDevMigrationHistoryProblems(repositoryRoot);
  if (problems.length > 0) {
    throw new Error(
      [
        'DEV migration-history parity failed before browser setup:',
        ...problems.map((problem) => `  - ${problem}`),
      ].join('\n'),
    );
  }
}
