import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type WorkspaceLockOwner = {
  token: string;
  processId: number;
  operation: string;
  startedAt: string;
};

export function workspaceTestLockPath(repositoryRoot = resolve(__dirname, "../..")): string {
  return resolve(repositoryRoot, ".agent-logs/workspace-test-operation.lock");
}

function readWorkspaceLockOwner(path: string): WorkspaceLockOwner {
  try {
    const owner: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!owner || typeof owner !== 'object' || !('token' in owner) || typeof owner.token !== 'string' || !owner.token || !('processId' in owner) || typeof owner.processId !== 'number' || !Number.isInteger(owner.processId) || owner.processId <= 0 || !('operation' in owner) || typeof owner.operation !== 'string' || !('startedAt' in owner) || typeof owner.startedAt !== 'string') throw new Error('Workspace lock owner data is invalid.');
    return owner as WorkspaceLockOwner;
  } catch (cause) {
    throw new Error(`Cannot verify the active workspace lock at ${path}. It is missing, unreadable or corrupt; inspect the owner and recover explicitly before continuing.`, { cause });
  }
}

export function assertWorkspaceTestLock(repositoryRoot?: string): void {
  const token = process.env.WERKFLOW_TEST_LOCK_TOKEN;
  const owner = readWorkspaceLockOwner(workspaceTestLockPath(repositoryRoot));
  if (!token || owner.token !== token) throw new Error("This process does not own the workspace test lock. Use the repository runner.");
  try { process.kill(owner.processId, 0); } catch { throw new Error("The workspace test lock owner is no longer running. Inspect and recover the interrupted run before continuing."); }
}

/** Holds ownership across awaited work; unlike a manifest lock, it covers the whole child lifetime. */
export async function withWorkspaceTestLock<T>(
  input: { operation: string; repositoryRoot?: string },
  operation: () => Promise<T>,
): Promise<T> {
  const path = workspaceTestLockPath(input.repositoryRoot);
  const inheritedToken = process.env.WERKFLOW_TEST_LOCK_TOKEN;
  const inheritedPath = process.env.WERKFLOW_TEST_LOCK_PATH;
  if (inheritedToken && (!inheritedPath || resolve(inheritedPath) === path)) {
    const inherited = readWorkspaceLockOwner(path);
    if (inherited.token !== inheritedToken) throw new Error('Inherited workspace lock ownership changed. Refusing to acquire replacement ownership.');
    if (inherited.processId !== process.pid) {
      assertWorkspaceTestLock(input.repositoryRoot);
      return operation();
    }
  }
  mkdirSync(resolve(path, ".."), { recursive: true });
  const owner: WorkspaceLockOwner = { token: randomUUID(), processId: process.pid, operation: input.operation, startedAt: new Date().toISOString() };
  let descriptor: number;
  try { descriptor = openSync(path, "wx"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const current = readFileSync(path, "utf8");
    throw new Error(`Another workspace operation owns ${path}: ${current}. Locks are never stolen automatically. Wait for it to finish; recover a killed owner's lock only after checking that no related test, build or cleanup process remains.`);
  }
  const previousToken = process.env.WERKFLOW_TEST_LOCK_TOKEN;
  const previousPath = process.env.WERKFLOW_TEST_LOCK_PATH;
  let operationFailed = false;
  try {
    writeFileSync(descriptor, JSON.stringify(owner));
    process.env.WERKFLOW_TEST_LOCK_TOKEN = owner.token;
    process.env.WERKFLOW_TEST_LOCK_PATH = path;
    return await operation();
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    if (previousToken === undefined) delete process.env.WERKFLOW_TEST_LOCK_TOKEN;
    else process.env.WERKFLOW_TEST_LOCK_TOKEN = previousToken;
    if (previousPath === undefined) delete process.env.WERKFLOW_TEST_LOCK_PATH;
    else process.env.WERKFLOW_TEST_LOCK_PATH = previousPath;
    try {
    closeSync(descriptor);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const current = JSON.parse(readFileSync(path, "utf8")) as WorkspaceLockOwner;
        if (current.token !== owner.token) throw new Error("Workspace lock ownership changed unexpectedly; refusing to remove it.");
        rmSync(path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 19 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
    }
    } catch (error) {
      if (!operationFailed) throw error;
      try { console.error(`[werkflow-test] Workspace lock release also failed: ${error instanceof Error ? error.message : String(error)}`); }
      catch { /* Preserve the original operation failure if diagnostic output is unavailable. */ }
    }
  }
}
