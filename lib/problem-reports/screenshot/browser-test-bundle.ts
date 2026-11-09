import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from '@/lib/zod';
import { collectUiStringCatalog } from './extract-ui-strings';

// Builds the redraw for a browser test, with the real catalog inlined as
// next.config.ts inlines it. Playwright runs specs under Node, so the build
// runs in a Bun child. No product page imports the redraw yet; the browser
// tests serve these modules to the page themselves.

const repositoryRoot = resolve(__dirname, '../../..');

// The modules a browser test imports, each served as `<name>.js`.
const REDRAW_TEST_ENTRIES = [
  'redraw-page',
  'rasterize',
  'redraw-screenshot',
  'load-ui-string-catalog',
] as const;

// The catalog arrives on stdin: it is too long for an argument.
const BUILD_SCRIPT = `
const [root, entries] = [process.argv[1], ${JSON.stringify(REDRAW_TEST_ENTRIES)}];
const catalog = await Bun.stdin.text();
const result = await Bun.build({
  entrypoints: entries.map((entry) => root + '/lib/problem-reports/screenshot/' + entry + '.ts'),
  target: 'browser',
  format: 'esm',
  splitting: true,
  naming: { entry: '[name].[ext]', chunk: '[name]-[hash].[ext]' },
  define: { 'process.env.WERKFLOW_UI_STRING_CATALOG': JSON.stringify(catalog) },
});
if (!result.success) throw new AggregateError(result.logs, 'The redraw bundle failed');
const files = {};
for (const output of result.outputs) files[output.path.split('/').pop()] = await output.text();
process.stdout.write(JSON.stringify(files));
`;

const bundleSchema = z.record(z.string(), z.string());

/** The built modules by file name. Serve them under one path; they import each other relatively. */
export function buildRedrawForBrowserTest(): ReadonlyMap<string, string> {
  const result = spawnSync('bun', ['-e', BUILD_SCRIPT, repositoryRoot], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: JSON.stringify(collectUiStringCatalog(repositoryRoot)),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`The redraw bundle failed:\n${result.stderr}`);
  const parsed: unknown = JSON.parse(result.stdout);
  return new Map(Object.entries(bundleSchema.parse(parsed)));
}
