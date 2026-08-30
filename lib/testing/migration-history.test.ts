import { describe, expect, test } from 'bun:test';

import {
  compareMigrationVersions,
  migrationVersionFromFileName,
} from './migration-history';

describe('migration history parity', () => {
  test('extracts only committed SQL migration versions', () => {
    expect(
      migrationVersionFromFileName('20260829120000_add_equipment.sql'),
    ).toBe('20260829120000');
    expect(migrationVersionFromFileName('README.md')).toBe(null);
    expect(migrationVersionFromFileName('broken_name.sql')).toBe(null);
  });

  test('reports missing, unexpected, and duplicate remote versions', () => {
    expect(
      compareMigrationVersions({
        committed: ['20260829120000', '20260829120100'],
        remote: ['20260829120000', '20260829120200', '20260829120200'],
      }),
    ).toEqual([
      'Missing remote migration versions: 20260829120100.',
      'Unexpected remote migration versions: 20260829120200.',
      'Duplicate remote migration versions: 20260829120200.',
    ]);
  });

  test('accepts exact parity regardless of input order', () => {
    expect(
      compareMigrationVersions({
        committed: ['20260829120100', '20260829120000'],
        remote: ['20260829120000', '20260829120100'],
      }),
    ).toEqual([]);
  });
});
