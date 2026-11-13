import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The price dialog stores the day a person picks. A browser east of Berlin
// answers 01.12.2026 as local midnight, which is still 30.11. in Berlin; the
// field keeps the picked calendar day (components/angebote/leistungen/leistung-price-fields.tsx).
test('a first valid day picked in a browser ahead of Berlin stays that day', async () => {
  const script = `
    const { parseIsoLocalDate, toLocalDateString } = await import('@/lib/utils');
    const picked = parseIsoLocalDate('2026-12-01');
    if (!picked) throw new Error('no date');
    console.log(toLocalDateString(picked));
  `;
  const child = Bun.spawn([process.execPath, '-e', script], {
    cwd: resolve(import.meta.dir, '../..'),
    env: { ...process.env, TZ: 'Europe/Helsinki' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stderr).toBe(0);
  expect(stdout.trim()).toBe('2026-12-01');
});
