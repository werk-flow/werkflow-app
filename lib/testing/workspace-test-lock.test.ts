import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from 'node:url';
import { assertWorkspaceTestLock, withWorkspaceTestLock, workspaceTestLockPath } from "./workspace-test-lock";

describe("workspace test operation ownership", () => {
  test('preserves the operation failure while reporting a secondary release failure', async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'werkflow-release-lock-'));
    const failure = new Error('Original operation failed');
    const reported = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(withWorkspaceTestLock({ operation: 'failed operation', repositoryRoot }, async () => {
        writeFileSync(workspaceTestLockPath(repositoryRoot), JSON.stringify({ token: 'changed' }));
        throw failure;
      })).rejects.toBe(failure);
      expect(reported).toHaveBeenCalled();
      await expect(withWorkspaceTestLock({ operation: 'successful operation', repositoryRoot: join(repositoryRoot, 'success') }, async () => {
        writeFileSync(workspaceTestLockPath(join(repositoryRoot, 'success')), JSON.stringify({ token: 'changed' }));
      })).rejects.toThrow('ownership changed');
    } finally { reported.mockRestore(); rmSync(repositoryRoot, { recursive: true, force: true }); }
  });

  test('never reacquires missing or corrupt declared inherited ownership', async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'werkflow-inherited-lock-'));
    const path = workspaceTestLockPath(repositoryRoot);
    const previousToken = process.env.WERKFLOW_TEST_LOCK_TOKEN;
    const previousPath = process.env.WERKFLOW_TEST_LOCK_PATH;
    let executed = false;
    try {
      process.env.WERKFLOW_TEST_LOCK_TOKEN = 'inherited';
      process.env.WERKFLOW_TEST_LOCK_PATH = path;
      for (const source of [null, '{partial', 'null']) {
        if (source !== null) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, source); }
        await expect(withWorkspaceTestLock({ operation: 'inherited child', repositoryRoot }, async () => { executed = true; })).rejects.toMatchObject({ message: expect.stringContaining('active workspace lock'), cause: expect.any(Error) });
      }
      expect(executed).toBe(false);
    } finally {
      if (previousToken === undefined) delete process.env.WERKFLOW_TEST_LOCK_TOKEN; else process.env.WERKFLOW_TEST_LOCK_TOKEN = previousToken;
      if (previousPath === undefined) delete process.env.WERKFLOW_TEST_LOCK_PATH; else process.env.WERKFLOW_TEST_LOCK_PATH = previousPath;
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
  test('loads the shared lock through the actual Playwright CommonJS test loader', async () => {
    const repositoryRoot = join(import.meta.dir, '../..');
    const child = Bun.spawn([process.execPath, 'x', 'playwright', 'test', '--list', '--config', 'tests/ui-contracts/playwright.config.ts', '--reporter=list'], {
      cwd: repositoryRoot, stdout: 'pipe', stderr: 'pipe', env: process.env,
    });
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, errors }).toEqual({ code: 0, errors: '' });
    expect(output).toContain('controls.spec.ts:');
  }, 30_000);
  test('allows an inherited child without releasing its parent operation lock', async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'werkflow-child-lock-'));
    try {
      await withWorkspaceTestLock({ operation: 'server preparation', repositoryRoot }, async () => {
        const moduleUrl = pathToFileURL(join(import.meta.dir, 'workspace-test-lock.ts')).href;
        const child = Bun.spawn([process.execPath, '-e', `import { withWorkspaceTestLock } from ${JSON.stringify(moduleUrl)}; await withWorkspaceTestLock({ operation: 'nested build', repositoryRoot: ${JSON.stringify(repositoryRoot)} }, async () => {});`], { stdout: 'pipe', stderr: 'pipe', env: process.env });
        const code = await child.exited;
        const errors = await new Response(child.stderr).text();
        expect({ code, errors }).toEqual({ code: 0, errors: '' });
        assertWorkspaceTestLock(repositoryRoot);
        expect(existsSync(workspaceTestLockPath(repositoryRoot))).toBe(true);
      });
      expect(existsSync(workspaceTestLockPath(repositoryRoot))).toBe(false);
    } finally { rmSync(repositoryRoot, { recursive: true, force: true }); }
  });
  test("holds the lock while an async battery is pending and releases after failure", async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "werkflow-operation-lock-"));
    try {
      await expect(withWorkspaceTestLock({ operation: "first battery", repositoryRoot }, async () => {
        assertWorkspaceTestLock(repositoryRoot);
        await Promise.resolve();
        await expect(withWorkspaceTestLock({ operation: "competing cleanup", repositoryRoot }, async () => undefined)).rejects.toThrow("Another workspace operation");
        throw new Error("child failed");
      })).rejects.toThrow("child failed");
      expect(existsSync(workspaceTestLockPath(repositoryRoot))).toBe(false);
      await withWorkspaceTestLock({ operation: "next battery", repositoryRoot }, async () => assertWorkspaceTestLock(repositoryRoot));
      expect(() => assertWorkspaceTestLock(repositoryRoot)).toThrow("active workspace lock");
    } finally { rmSync(repositoryRoot, { recursive: true, force: true }); }
  });
});
