// Compiles the vendored CEN EN 16931 CII rules into the SaxonJS stylesheet the
// run-time check loads: `bun run rules:en16931` after replacing
// EN16931-CII-validation.xslt with a new CEN release. It takes about two
// minutes, so the app ships the compiled result instead of compiling at start.
//
// The XSLT is copied to a fixed neutral folder first, because the compiled
// file records the path it was compiled from. The output is gzipped with a
// zero timestamp; `manifest.ts` records both files' SHA-256, which
// `check-en16931.test.ts` compares, so a rule file never changes without its
// compiled twin.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const xsltName = 'EN16931-CII-validation.xslt';
const neutralFolder = join(tmpdir(), 'werkflow-en16931');
const workFolder = mkdtempSync(join(tmpdir(), 'werkflow-en16931-sef-'));

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

try {
  mkdirSync(neutralFolder, { recursive: true });
  const xsltCopy = join(neutralFolder, xsltName);
  copyFileSync(join(here, xsltName), xsltCopy);
  const sefPath = join(workFolder, 'en16931-cii.sef.json');
  const compiler = fileURLToPath(import.meta.resolve('xslt3/xslt3.js'));
  const result = spawnSync(
    'node',
    [compiler, `-xsl:${xsltCopy}`, `-export:${sefPath}`, '-nogo', '-relocate:on'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error(`xslt3 stopped with status ${String(result.status)}.`);
  const compiled = gzipSync(readFileSync(sefPath), { level: 9 });
  writeFileSync(join(here, 'en16931-cii.sef.json.gz'), compiled);
  const xslt = readFileSync(join(here, xsltName));
  const release = /Schematron version ([\d.]+)/.exec(xslt.toString('utf8'))?.[1];
  if (!release) throw new Error('The XSLT names no Schematron version.');
  writeFileSync(
    join(here, 'manifest.ts'),
    [
      '// Written by compile.ts; check-en16931.test.ts compares both hashes with the files.',
      'export const EN16931_CII_RULES = {',
      `  release: '${release}',`,
      `  xsltSha256: '${sha256(xslt)}',`,
      `  sefGzipSha256: '${sha256(compiled)}',`,
      '};',
      '',
    ].join('\n'),
  );
} finally {
  rmSync(workFolder, { recursive: true, force: true });
}
