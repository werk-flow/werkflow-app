import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { PARKING_ERROR_MESSAGES } from './types';

// The actions need module mocks for identity, cookies and the database, which
// would leak into other test files; the fixture runs them in its own process.
test('Parkplatz actions validate input first, admit only managers, and stay inside the caller organization', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/parking-action-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});

test('every error code the Parkplatz actions return has a German message', () => {
  for (const code of [
    'invalid_input',
    'not_authorized',
    'job_not_parked',
    'load_failed',
    'responsible_not_manager',
    'stale_version',
    'update_failed',
  ]) {
    expect(PARKING_ERROR_MESSAGES[code], code).toBeString();
  }
});
