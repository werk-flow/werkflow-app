// A failed responsibility read is its own failure: never "not responsible"
// (a silently hidden Perioden tab) and never access. The file spawns itself:
// module mocks stay in the child.
import assert from 'node:assert/strict';
import { expect, mock, test } from 'bun:test';

const FIXTURE_FLAG = 'TIME_ACCOUNT_ACCESS_FIXTURE';

async function runFixture(): Promise<void> {
  const responsibility = { stateLoads: true, holderUserIds: new Set<string>() };
  let stateReads = 0;
  mock.module('server-only', () => ({}));
  mock.module('next/navigation', () => ({ redirect: () => undefined }));
  mock.module('@/lib/jobs/auth', () => ({ authenticateAndAuthorize: async () => ({ success: false }) }));
  mock.module('@/lib/responsibilities/server', () => ({
    loadResponsibilityRuntimeState: async () => {
      stateReads += 1;
      return responsibility.stateLoads ? {} : null;
    },
    getEffectiveResponsibilityHolderForActor: async (input: { actorUserId: string }) =>
      responsibility.stateLoads && responsibility.holderUserIds.has(input.actorUserId)
        ? { userId: input.actorUserId }
        : null,
  }));
  const { readTimeAccountManagement } = await import('./access');
  const employee = { orgId: 'organization', userId: 'employee', isManagerOrAbove: false };

  // Admin and Büro manage without a responsibility read.
  assert.deepEqual(await readTimeAccountManagement({ ...employee, isManagerOrAbove: true }), {
    success: true,
    canManage: true,
  });
  assert.equal(stateReads, 0);

  assert.deepEqual(await readTimeAccountManagement(employee), { success: true, canManage: false });

  responsibility.holderUserIds.add('employee');
  assert.deepEqual(await readTimeAccountManagement(employee), { success: true, canManage: true });

  responsibility.stateLoads = false;
  assert.deepEqual(await readTimeAccountManagement(employee), {
    success: false,
    error: 'responsibility_load_failed',
  });
}

if (process.env[FIXTURE_FLAG] === '1') {
  await runFixture();
} else {
  test('a failed responsibility read is a failure, not "not responsible" and not access', async () => {
    const child = Bun.spawn([process.execPath, import.meta.path], {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, [FIXTURE_FLAG]: '1' },
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
}
