import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  compareMigrationVersions,
  migrationVersionFromFileName,
} from './migration-history';
import { requireEnv } from '../../tests/golden/support/env';

const DEV_PROJECT_REF = 'mbkkzuqjbdvzelqvuzcn';
const migrationRowsSchema = z.array(z.object({ version: z.string() }));

export function validateSupabaseCliLink(
  linkedProjectRef: string | null,
): string[] {
  if (linkedProjectRef === null || linkedProjectRef === DEV_PROJECT_REF) {
    return [];
  }

  return [
    `Supabase CLI is linked to ${linkedProjectRef}, not DEV ${DEV_PROJECT_REF}. Relink DEV before any CLI migration command.`,
  ];
}

function readLinkedProjectRef(repositoryRoot: string): string | null {
  try {
    return readFileSync(
      resolve(repositoryRoot, 'supabase/.temp/project-ref'),
      'utf8',
    ).trim();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

export function committedMigrationVersions(
  repositoryRoot = process.cwd(),
): string[] {
  return readdirSync(resolve(repositoryRoot, 'supabase/migrations'))
    .map(migrationVersionFromFileName)
    .filter((version): version is string => version !== null)
    .sort();
}

async function remoteDevMigrationVersions(): Promise<string[]> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireEnv('SUPABASE_ACCESS_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query:
          'select version from supabase_migrations.schema_migrations order by version',
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status !== 201) {
    throw new Error(
      `DEV migration-history query returned HTTP ${response.status}.`,
    );
  }
  return migrationRowsSchema
    .parse(await response.json())
    .map((row) => row.version);
}

export async function getDevMigrationHistoryProblems(
  repositoryRoot = process.cwd(),
): Promise<string[]> {
  return [
    ...validateSupabaseCliLink(readLinkedProjectRef(repositoryRoot)),
    ...compareMigrationVersions({
      committed: committedMigrationVersions(repositoryRoot),
      remote: await remoteDevMigrationVersions(),
    }),
  ];
}

export async function assertDevMigrationHistoryParity(
  repositoryRoot = process.cwd(),
): Promise<void> {
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
