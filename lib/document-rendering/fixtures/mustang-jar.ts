// Mustang's jar for check-reference-e-invoices.ts, pinned by version and SHA-256. Maven Central
// answered 429 to CI's download (#516, #539), so CI's E-invoices job restores the jar from the
// Actions cache under the key this file prints, and a download retries a busy answer.
// Usage: bun lib/document-rendering/fixtures/mustang-jar.ts         prints the cache's key and path
//        bun lib/document-rendering/fixtures/mustang-jar.ts verify  exits 0 only for the pinned jar

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const MUSTANG_VERSION = '2.26.0';
const MUSTANG_SHA256 = '42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736';
/** The jar from the repository root; ci.yml caches exactly this file. */
const MUSTANG_PATH = `node_modules/.cache/mustang/Mustang-CLI-${MUSTANG_VERSION}.jar`;

/** A file fetched from `url` and kept at `path`, used only while its SHA-256 is `sha256`. */
interface Pin {
  url: string;
  sha256: string;
  path: string;
}

interface Network {
  /** Must stop the request, headers and body, when `signal` aborts. */
  fetch: (url: string, signal: AbortSignal) => Promise<Response>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

/** The deadline of one request, headers and body, and of the whole download with its waits. */
interface Limits {
  requestMs: number;
  totalMs: number;
}

const NETWORK: Network = {
  fetch: (url, signal) => fetch(url, { signal }),
  wait: (ms) => Bun.sleep(ms),
  now: () => Date.now(),
};
/** Four minutes at most, so the job's 20 minutes stay for the invoice checks. */
const LIMITS: Limits = { requestMs: 60_000, totalMs: 4 * 60_000 };
/** The waits before each retry of a busy answer. */
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Whether the file at `path` exists and has the SHA-256 `expected`. */
export const matches = (path: string, expected: string): boolean =>
  existsSync(path) && sha256(readFileSync(path)) === expected;

/** Whether a mirror answer says "later": rate limited or briefly unavailable. */
const busy = (status: number): boolean => status === 429 || status >= 500;

/** One request whose answer and body arrive within `ms`. */
async function download(
  url: string,
  ms: number,
  network: Network,
): Promise<{ status: number; bytes?: Uint8Array }> {
  const signal = AbortSignal.timeout(ms);
  const response = await network.fetch(url, signal);
  if (!response.ok) return { status: response.status };
  return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
}

/**
 * The pinned file's path. A kept file serves only when its SHA-256 matches. Otherwise the file is
 * downloaded within the limits, retried after a busy answer, and published under its path by a
 * rename only after its SHA-256 matched. Any other outcome throws, and the path keeps no byte of it.
 */
export async function pinnedFile(
  pin: Pin,
  network: Network = NETWORK,
  limits: Limits = LIMITS,
): Promise<string> {
  if (matches(pin.path, pin.sha256)) return pin.path;
  const deadline = network.now() + limits.totalMs;
  const left = (): number => deadline - network.now();
  let answer = await download(pin.url, Math.min(limits.requestMs, left()), network);
  for (const delay of RETRY_DELAYS_MS) {
    if (!busy(answer.status) || left() <= delay) break;
    // Product code under lib/ logs through lib/logging.ts; this line names a public URL only.
    process.stderr.write(`${pin.url} answered ${answer.status}; retrying in ${delay / 1000} s.\n`);
    await network.wait(delay);
    answer = await download(pin.url, Math.min(limits.requestMs, left()), network);
  }
  if (!answer.bytes) throw new Error(`${pin.url} answered ${answer.status}.`);
  const digest = sha256(answer.bytes);
  if (digest !== pin.sha256)
    throw new Error(`${pin.url} has the SHA-256 ${digest}, not the pinned ${pin.sha256}.`);
  mkdirSync(dirname(pin.path), { recursive: true });
  // The rename stays inside one file system, so the path holds the old file or the whole new one.
  const staging = mkdtempSync(join(dirname(pin.path), '.download-'));
  try {
    const partial = join(staging, basename(pin.path));
    writeFileSync(partial, answer.bytes);
    renameSync(partial, pin.path);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return pin.path;
}

/**
 * A read-only copy of the verified file in a fresh folder only this process can write, verified
 * again, so a later change to `path` never reaches whoever runs the copy.
 */
export function privateCopy(path: string, expected: string): string {
  const bytes = readFileSync(path);
  if (sha256(bytes) !== expected) throw new Error(`${path} does not have the pinned SHA-256.`);
  const copy = join(mkdtempSync(join(tmpdir(), 'mustang-')), basename(path));
  writeFileSync(copy, bytes, { mode: 0o444 });
  chmodSync(copy, 0o444);
  if (!matches(copy, expected)) throw new Error(`The copy ${copy} does not have the pinned SHA-256.`);
  return copy;
}

/** A private, verified copy of Mustang's jar, cached in the repository and downloaded on a miss. */
export async function mustangJar(repository: string): Promise<string> {
  const pin = {
    url: `https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar`,
    sha256: MUSTANG_SHA256,
    path: join(resolve(repository), MUSTANG_PATH),
  };
  return privateCopy(await pinnedFile(pin), MUSTANG_SHA256);
}

if (import.meta.main) {
  // A version or checksum change misses the cache, and the next download is verified against it.
  if (process.argv[2] === undefined)
    process.stdout.write(`key=mustang-${MUSTANG_VERSION}-${MUSTANG_SHA256}\npath=${MUSTANG_PATH}\n`);
  else if (
    process.argv[2] === 'verify' &&
    matches(resolve(import.meta.dir, '../../..', MUSTANG_PATH), MUSTANG_SHA256)
  )
    process.stdout.write(`${MUSTANG_PATH} has the pinned SHA-256.\n`);
  else {
    process.stderr.write(`${MUSTANG_PATH} is missing or does not have the pinned SHA-256.\n`);
    process.exitCode = 1;
  }
}
