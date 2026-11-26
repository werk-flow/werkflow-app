import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The credit note signal issues and checks its Storno with SaxonJS, which
// decides at load whether it runs in a browser; earlier files of the
// one-process unit run leave a `window` global, and the cases replace the
// database and the network. Their own process keeps both apart.
test('a refund mails its Stornorechnung, and any new invoice, to the billing contact once; a refused send stays failed and goes on the next delivery', async () => {
  const child = Bun.spawn([process.execPath, 'test', './lib/testing/fixtures/werkflow-refund-mails.ts'], {
    cwd: resolve(import.meta.dir, '../..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
