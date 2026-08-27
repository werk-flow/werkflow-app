import { randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function sleepSynchronously(milliseconds: number): void {
  Atomics.wait(WAIT_BUFFER, 0, 0, milliseconds);
}

export function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    for (let attempt = 1; ; attempt += 1) {
      try {
        renameSync(temporaryPath, path);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 20 || (code !== 'EPERM' && code !== 'EACCES')) throw error;
        sleepSynchronously(25);
      }
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function withFileLock<T>(
  path: string,
  operation: () => T,
  options: { timeoutMilliseconds?: number } = {}
): T {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const token = `${process.pid}:${randomBytes(12).toString('hex')}`;
  const deadline = Date.now() + (options.timeoutMilliseconds ?? 10_000);
  let descriptor: number | null = null;
  while (descriptor === null) {
    try {
      const candidateDescriptor = openSync(path, 'wx');
      try {
        writeFileSync(candidateDescriptor, token);
        descriptor = candidateDescriptor;
      } catch (error) {
        closeSync(candidateDescriptor);
        rmSync(path, { force: true });
        throw error;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for file lock ${path}. Locks are never stolen automatically; if no test process is running, a killed process left this lock behind — delete that file manually to recover.`
        );
      }
      sleepSynchronously(25);
    }
  }
  try {
    return operation();
  } finally {
    closeSync(descriptor);
    try {
      if (readFileSync(path, 'utf8') === token) rmSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
