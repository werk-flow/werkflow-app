import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 1 and 2 for Zod's eval probe (AGENTS.md "3. Security"). The content
// security policy has no 'unsafe-eval'. Zod 4 probes `Function("")` when the
// first object schema is built, and in the browser every page load then
// reported one `eval` violation to /api/csp-report. lib/zod.ts sets
// `jitless` before any schema exists, which holds only while every schema
// module imports `z` from there.

const ENTRY = 'lib/zod.ts';
const ZOD_SPECIFIER = /\bfrom\s+['"]zod(?:\/[^'"]*)?['"]|\bimport\s*\(\s*['"]zod(?:\/[^'"]*)?['"]\s*\)/;

/** How many times the `Function` constructor runs while a schema from `entry` is built and used. */
function functionConstructorCalls(entry: string): number {
  const script = `
    let calls = 0;
    const Original = globalThis.Function;
    globalThis.Function = new Proxy(Original, {
      construct(target, args, newTarget) { calls += 1; return Reflect.construct(target, args, newTarget); },
      apply(target, self, args) { calls += 1; return Reflect.apply(target, self, args); },
    });
    const { z } = await import(${JSON.stringify(entry)});
    const schema = z.object({ name: z.string(), tags: z.array(z.object({ id: z.number() })) });
    schema.parse({ name: 'Heizung', tags: [{ id: 1 }] });
    schema.safeParse({ name: 1 });
    console.log(String(calls));
  `;
  const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: repositoryRoot });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return Number(result.stdout.toString().trim());
}

describe('Zod entry point', () => {
  test('product code imports Zod only through lib/zod.ts', () => {
    const offenders = listProductSources().filter(
      (file) => file !== ENTRY && ZOD_SPECIFIER.test(readFileSync(resolve(repositoryRoot, file), 'utf8')),
    );
    expect(offenders, "Import `z` from '@/lib/zod' so jitless is set before the schema is built.").toEqual(
      [],
    );
  });

  test('building and parsing a schema through the entry point never calls the Function constructor', () => {
    expect(functionConstructorCalls(resolve(repositoryRoot, ENTRY))).toBe(0);
  });

  test('the probe detection works: plain Zod calls the Function constructor', () => {
    expect(functionConstructorCalls('zod')).toBeGreaterThan(0);
  });
});
