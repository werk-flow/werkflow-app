// Mustang's jar for check-reference-e-invoices.ts, pinned by version and SHA-256. Maven Central
// answered 429 to CI's download (#516, #539), so CI's E-invoices job restores the jar from the
// Actions cache under the key this file prints when run, and a download retries a busy answer.
// Usage: bun lib/document-rendering/fixtures/mustang-jar.ts (prints the cache's key and path)

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MUSTANG_VERSION = '2.26.0';
const MUSTANG_SHA256 = '42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736';
/** The jar's folder from the repository root; ci.yml caches this folder. */
const MUSTANG_FOLDER = 'node_modules/.cache/mustang';

/** A file fetched from `url` and kept at `path`, used only while its SHA-256 is `sha256`. */
interface Pin {
  url: string;
  sha256: string;
  path: string;
}

interface Network {
  fetch: (url: string) => Promise<Response>;
  wait: (ms: number) => Promise<void>;
}

/** The waits before each retry of a busy answer, about a minute and a half in all. */
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Whether a mirror answer says "later": rate limited or briefly unavailable. */
const busy = (status: number): boolean => status === 429 || status >= 500;

/**
 * The pinned file's path. A kept file serves only when its SHA-256 matches; otherwise the file is
 * downloaded, retried after a busy answer, and kept only when its SHA-256 matches. Any other
 * outcome throws, so no unverified byte is ever used.
 */
export async function pinnedFile(
  pin: Pin,
  network: Network = { fetch: (url) => fetch(url), wait: (ms) => Bun.sleep(ms) },
): Promise<string> {
  if (existsSync(pin.path) && sha256(readFileSync(pin.path)) === pin.sha256) return pin.path;
  let response = await network.fetch(pin.url);
  for (const delay of RETRY_DELAYS_MS) {
    if (!busy(response.status)) break;
    // Product code under lib/ logs through lib/logging.ts; this line names a public URL only.
    process.stderr.write(`${pin.url} answered ${response.status}; retrying in ${delay / 1000} s.\n`);
    await network.wait(delay);
    response = await network.fetch(pin.url);
  }
  if (!response.ok) throw new Error(`${pin.url} answered ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== pin.sha256)
    throw new Error(`${pin.url} has the SHA-256 ${digest}, not the pinned ${pin.sha256}.`);
  mkdirSync(dirname(pin.path), { recursive: true });
  writeFileSync(pin.path, bytes);
  return pin.path;
}

/** Mustang's verified jar in the repository's cache folder. */
export const mustangJar = (repository: string): Promise<string> =>
  pinnedFile({
    url: `https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar`,
    sha256: MUSTANG_SHA256,
    path: join(resolve(repository), MUSTANG_FOLDER, `Mustang-CLI-${MUSTANG_VERSION}.jar`),
  });

// A version or checksum change misses the cache, and the next download is verified against it.
if (import.meta.main)
  process.stdout.write(`key=mustang-${MUSTANG_VERSION}-${MUSTANG_SHA256}\npath=${MUSTANG_FOLDER}\n`);
