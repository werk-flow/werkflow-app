import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tier 2 guard for SI-010. The R2 adapter and the S3 SDK carry bucket
// credentials from process.env and must never be reachable from browser
// code. `import 'server-only'` is not an option there: Bun-run scripts and
// the test harness import the adapter outside Next (the admin client can use
// it because no script imports that module). Product client roots are scanned
// instead; server modules under lib/ and scripts/ remain free to import it.

const repositoryRoot = resolve(import.meta.dir, '../..');
const bannedSpecifiers = ['@/lib/storage/r2', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'];
const clientRoots = ['app', 'components', 'hooks'];

function listSources(root: string): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
    }
  }
  visit(root);
  return found;
}

test('browser-reachable roots never import the storage adapter or the S3 SDK', () => {
  const offenders: string[] = [];
  for (const root of clientRoots) {
    for (const file of listSources(root)) {
      const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
      for (const specifier of bannedSpecifiers) {
        if (source.includes(`from '${specifier}'`) || source.includes(`from "${specifier}"`)) {
          offenders.push(`${file} imports ${specifier}`);
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});

test('the admin client keeps its build-time server-only guard', () => {
  const source = readFileSync(resolve(repositoryRoot, 'lib/supabase/admin.ts'), 'utf8');
  expect(source).toContain("import 'server-only';");
});
