// A pinned file is used only with its pinned SHA-256, a kept one costs no download, a busy mirror
// is retried within a deadline, Java runs a private verified copy, and only the verified jar enters
// CI's cache (mustang-jar.ts).
import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readWorkflow } from '../../testing/ci-workflow';
import { matches, pinnedFile, privateCopy } from './mustang-jar';

const JAR = new TextEncoder().encode('the pinned jar');
const TAMPERED = new TextEncoder().encode('a tampered jar');
const SHA256 = createHash('sha256').update(JAR).digest('hex');
const URL = 'https://mirror.test/Mustang-CLI.jar';
const LIMITS = { requestMs: 60_000, totalMs: 4 * 60_000 };
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
  const created = mkdtempSync(join(tmpdir(), 'mustang-jar-'));
  folders.push(created);
  return created;
}

const pinIn = (): { url: string; sha256: string; path: string } => ({
  url: URL,
  sha256: SHA256,
  path: join(folder(), 'cache/jar'),
});

function keep(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/**
 * A network on a fake clock that answers each fetch with the next status, the given bytes on a
 * 200; each request takes `takesMs` of the clock.
 */
function network(statuses: number[], body: Uint8Array<ArrayBuffer> = JAR, takesMs = 0) {
  const fetched: string[] = [];
  const waited: number[] = [];
  let clock = 0;
  return {
    fetched,
    waited,
    now: () => clock,
    fetch: async (url: string): Promise<Response> => {
      fetched.push(url);
      clock += takesMs;
      const status = statuses[fetched.length - 1];
      if (status === undefined) throw new Error('fetched more often than the test allows');
      return new Response(status === 200 ? body : null, { status });
    },
    wait: async (ms: number): Promise<void> => {
      waited.push(ms);
      clock += ms;
    },
  };
}

test('a download whose SHA-256 differs from the pin is refused and never kept', async () => {
  const pin = pinIn();
  await expect(pinnedFile(pin, network([200], TAMPERED))).rejects.toThrow('not the pinned');
  expect(readdirSync(dirname(dirname(pin.path)))).toEqual([]);
});

test('a tampered kept file is replaced by a verified download, never used, and no staging file stays', async () => {
  const pin = pinIn();
  keep(pin.path, TAMPERED);
  const mirror = network([200]);
  expect(await pinnedFile(pin, mirror)).toBe(pin.path);
  expect(mirror.fetched).toEqual([URL]);
  expect(readFileSync(pin.path)).toEqual(Buffer.from(JAR));
  expect(readdirSync(dirname(pin.path))).toEqual(['jar']);
});

test('a refused download leaves a kept file as it was', async () => {
  const pin = pinIn();
  keep(pin.path, TAMPERED);
  await expect(pinnedFile(pin, network([200], TAMPERED))).rejects.toThrow('not the pinned');
  expect(readFileSync(pin.path)).toEqual(Buffer.from(TAMPERED));
  expect(readdirSync(dirname(pin.path))).toEqual(['jar']);
});

test('a kept file with the pinned SHA-256 is used without a network call', async () => {
  const pin = pinIn();
  keep(pin.path, JAR);
  const mirror = network([]);
  expect(await pinnedFile(pin, mirror)).toBe(pin.path);
  expect(mirror.fetched).toEqual([]);
});

test('a 429 and then a 200 yields the verified file after one wait', async () => {
  const pin = pinIn();
  const mirror = network([429, 200]);
  expect(await pinnedFile(pin, mirror)).toBe(pin.path);
  expect(mirror.fetched).toEqual([URL, URL]);
  expect(mirror.waited).toEqual([5_000]);
  expect(readFileSync(pin.path)).toEqual(Buffer.from(JAR));
});

test('a mirror busy beyond the retries fails with its last answer', async () => {
  const mirror = network([429, 429, 429, 429]);
  await expect(pinnedFile(pinIn(), mirror)).rejects.toThrow(`${URL} answered 429.`);
  expect(mirror.fetched).toHaveLength(4);
});

test('slow busy answers stop retrying before the total budget ends', async () => {
  // 70 s per request: 0-70, wait 5, 75-145, wait 20, 165-235; a wait of 60 would pass 240 s.
  const mirror = network([429, 429, 429, 429], JAR, 70_000);
  await expect(pinnedFile(pinIn(), mirror, LIMITS)).rejects.toThrow('answered 429.');
  expect(mirror.fetched).toHaveLength(3);
  expect(mirror.now()).toBeLessThanOrEqual(LIMITS.totalMs);
});

// Without the deadline the body would never end, so the stub ends it with another error after 2 s.
test('a body that stalls is aborted at the request deadline', async () => {
  const stalled = {
    now: () => 0,
    wait: async () => {},
    fetch: async (_url: string, signal: AbortSignal): Promise<Response> =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(JAR);
            const guard = setTimeout(() => controller.error(new Error('no deadline ended the body')), 2_000);
            signal.addEventListener('abort', () => {
              clearTimeout(guard);
              controller.error(signal.reason);
            });
          },
        }),
        { status: 200 },
      ),
  };
  await expect(pinnedFile(pinIn(), stalled, { requestMs: 50, totalMs: 1_000 })).rejects.toMatchObject({
    name: 'TimeoutError',
  });
});

test('a refusal that is not busy fails at once', async () => {
  const mirror = network([404]);
  await expect(pinnedFile(pinIn(), mirror)).rejects.toThrow('answered 404.');
  expect(mirror.waited).toEqual([]);
});

test('the private copy is verified, read-only, in a fresh folder only its owner can write, and keeps the verified bytes', () => {
  const source = join(folder(), 'jar');
  keep(source, TAMPERED);
  expect(() => privateCopy(source, SHA256)).toThrow('does not have the pinned SHA-256');
  writeFileSync(source, JAR);
  const copy = privateCopy(source, SHA256);
  folders.push(dirname(copy));
  expect(dirname(copy)).not.toBe(dirname(source));
  expect(statSync(dirname(copy)).mode & 0o777).toBe(0o700);
  expect(statSync(copy).mode & 0o777).toBe(0o444);
  writeFileSync(source, TAMPERED);
  expect(matches(copy, SHA256)).toBe(true);
  expect(readdirSync(dirname(copy))).toEqual(['jar']);
});

test('a private copy whose write or check fails leaves no folder behind', () => {
  const source = join(folder(), 'jar');
  keep(source, JAR);
  const parent = folder();
  const full = (): void => {
    throw new Error('ENOSPC: no space left on device');
  };
  expect(() => privateCopy(source, SHA256, { parent, write: full })).toThrow('ENOSPC');
  expect(readdirSync(parent)).toEqual([]);
  const tampering = (file: string): void => writeFileSync(file, TAMPERED);
  expect(() => privateCopy(source, SHA256, { parent, write: tampering })).toThrow('does not have the pinned');
  expect(readdirSync(parent)).toEqual([]);
});

test('Mustang runs only the private copy, mounted as one read-only file', () => {
  const script = readFileSync(join(import.meta.dir, 'check-reference-e-invoices.ts'), 'utf8');
  const mounts = [...script.matchAll(/`\$\{(\w+)\}:([^`]+)`/g)].map((match) => `${match[1]} ${match[2]}`);
  expect(mounts).toEqual(['pdfs /data:ro', 'jar /mustang.jar:ro', 'pdfs /data:ro']);
  expect(script).toContain('await mustangJar(repository)');
});

test("CI caches only the pinned jar's one file, and only after the verify step passed", () => {
  const printed = spawnSync(process.execPath, [join(import.meta.dir, 'mustang-jar.ts')], {
    encoding: 'utf8',
  });
  expect(printed.stdout).toMatch(
    /^key=mustang-[\d.]+-[0-9a-f]{64}\npath=node_modules\/\.cache\/mustang\/Mustang-CLI-[\d.]+\.jar\n$/,
  );
  const steps = readWorkflow('ci.yml').at('jobs', 'invoices', 'steps');
  if (!Array.isArray(steps)) throw new Error('ci.yml has no invoices steps');
  const step = (name: string): unknown => steps.find((candidate) => candidate?.name === name);
  expect(step("Verify Mustang's jar before caching it")).toMatchObject({
    id: 'mustang-verified',
    run: 'bun lib/document-rendering/fixtures/mustang-jar.ts verify',
  });
  expect(step("Cache Mustang's jar")).toMatchObject({
    if: "always() && steps.mustang-verified.outcome == 'success'",
    with: { path: '${{ steps.mustang.outputs.path }}' },
  });
});

test('the pre-save check refuses a missing or tampered jar', () => {
  const path = join(folder(), 'jar');
  expect(matches(path, SHA256)).toBe(false);
  keep(path, TAMPERED);
  expect(matches(path, SHA256)).toBe(false);
  writeFileSync(path, JAR);
  expect(matches(path, SHA256)).toBe(true);
});
