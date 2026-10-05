import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { getOptionalSupabaseUrl, getSupabasePublishableKey, getSupabaseUrl } from './public';

const PUBLIC_VARIABLES = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] as const;

describe('public environment readers', () => {
  const original: Partial<Record<(typeof PUBLIC_VARIABLES)[number], string>> = {};

  beforeEach(() => {
    for (const variable of PUBLIC_VARIABLES) {
      const value = process.env[variable];
      if (value !== undefined) original[variable] = value;
      delete process.env[variable];
    }
  });

  afterEach(() => {
    for (const variable of PUBLIC_VARIABLES) {
      const value = original[variable];
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
  });

  test('a missing or blank required variable throws with the variable name', () => {
    expect(getSupabaseUrl).toThrow('Missing NEXT_PUBLIC_SUPABASE_URL environment variable.');
    expect(getSupabasePublishableKey).toThrow(
      'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY environment variable.',
    );
    process.env.NEXT_PUBLIC_SUPABASE_URL = '   ';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '';
    expect(getSupabaseUrl).toThrow('Missing NEXT_PUBLIC_SUPABASE_URL environment variable.');
    expect(getSupabasePublishableKey).toThrow(
      'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY environment variable.',
    );
  });

  test('set variables are returned without surrounding whitespace', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = ' https://project.example.test \n';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '\tpublishable-fixture ';
    expect(getSupabaseUrl()).toBe('https://project.example.test');
    expect(getSupabasePublishableKey()).toBe('publishable-fixture');
  });

  test('the optional URL reader reports absence instead of throwing', () => {
    expect(getOptionalSupabaseUrl()).toBeUndefined();
    process.env.NEXT_PUBLIC_SUPABASE_URL = ' https://project.example.test ';
    expect(getOptionalSupabaseUrl()).toBe('https://project.example.test');
  });
});

test('server environment readers require their secrets and treat blank values as missing', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/server-environment-reads.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
