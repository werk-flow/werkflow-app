import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { withFileLock } from '../runner/file-lock';

/**
 * The evidence the publication gate reads (verification reports, review records) is plain JSON in
 * a gitignored folder. Until 2026-10-16 any edit of it went unnoticed (audit finding B7). Each
 * writer now appends the file's content digest to this hash chain, and the gate trusts a record
 * only while its bytes equal the last digest the chain holds for its path and the chain is intact.
 * The edit guard refuses agent writes to the evidence folders and to the chain at all times.
 * Residual: a process that runs this module's writer can still record a forged file; only a key
 * outside the agent's reach (an HMAC) closes that, which is an owner question.
 */
export const EVIDENCE_LEDGER = '.agent-logs/evidence-ledger.jsonl';
const GENESIS = 'genesis';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.object({
  path: z.string().min(1),
  digest: sha256,
  previous: z.union([sha256, z.literal(GENESIS)]),
  recordedAt: z.string().datetime(),
  reason: z.string().min(1),
  hash: sha256,
});
type LedgerEntry = z.infer<typeof entrySchema>;

function evidenceDigest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function entryHash(entry: Omit<LedgerEntry, 'hash'>): string {
  return evidenceDigest(
    JSON.stringify([entry.previous, entry.path, entry.digest, entry.recordedAt, entry.reason]),
  );
}

export type Ledger = {
  /** The last recorded digest of each path. */
  latest: ReadonlyMap<string, string>;
  /** Every break of the chain: an unreadable line, a wrong hash or a wrong predecessor. */
  problems: readonly string[];
  head: string;
};

/** Reads the chain and checks every link. */
export function readLedger(text: string): Ledger {
  const latest = new Map<string, string>();
  const problems: string[] = [];
  let head = GENESIS;
  text
    .split('\n')
    .filter((line) => line.trim())
    .forEach((line, index) => {
      let parsed: LedgerEntry;
      try {
        parsed = entrySchema.parse(JSON.parse(line));
      } catch (error) {
        problems.push(
          `line ${index + 1} is no ledger entry (${error instanceof Error ? error.message : String(error)})`,
        );
        return;
      }
      const { hash, ...body } = parsed;
      if (parsed.previous !== head) problems.push(`line ${index + 1} does not follow its predecessor`);
      if (entryHash(body) !== hash) problems.push(`line ${index + 1} does not match its hash`);
      head = hash;
      latest.set(parsed.path, parsed.digest);
    });
  return { latest, problems, head };
}

/** The ledger line that records `bytes` as the content of `path`, after `head`. */
export function ledgerLine(input: {
  head: string;
  path: string;
  bytes: Uint8Array | string;
  reason: string;
  now: Date;
}): string {
  const body = {
    path: input.path,
    digest: evidenceDigest(input.bytes),
    previous: input.head,
    recordedAt: input.now.toISOString(),
    reason: input.reason,
  };
  return `${JSON.stringify({ ...body, hash: entryHash(body) })}\n`;
}

/** True when the chain is intact and its last digest for `path` is the digest of `bytes`. */
export function recordedEvidence(ledger: Ledger, path: string, bytes: Uint8Array | string): boolean {
  return ledger.problems.length === 0 && ledger.latest.get(path) === evidenceDigest(bytes);
}

export function readRepositoryLedger(repositoryRoot: string): Ledger {
  const file = resolve(repositoryRoot, EVIDENCE_LEDGER);
  return readLedger(existsSync(file) ? readFileSync(file, 'utf8') : '');
}

/** Appends the current content of `relativePath` to the chain; refuses to extend a broken chain. */
export function recordEvidence(repositoryRoot: string, relativePath: string, reason: string): void {
  const file = resolve(repositoryRoot, EVIDENCE_LEDGER);
  withFileLock(`${file}.lock`, () => {
    const ledger = readRepositoryLedger(repositoryRoot);
    if (ledger.problems.length)
      throw new Error(
        `The evidence ledger ${EVIDENCE_LEDGER} is broken: ${ledger.problems.join('; ')}. Report it to the owner; never repair it by hand.`,
      );
    const bytes = readFileSync(resolve(repositoryRoot, relativePath));
    appendFileSync(
      file,
      ledgerLine({ head: ledger.head, path: relativePath, bytes, reason, now: new Date() }),
    );
  });
}
