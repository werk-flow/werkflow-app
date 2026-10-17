import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EVIDENCE_LEDGER,
  ledgerLine,
  readLedger,
  readRepositoryLedger,
  recordedEvidence,
  recordEvidence,
} from './evidence-ledger';

const now = new Date('2026-10-16T12:00:00.000Z');
const report = '.agent-logs/verification/r1/report.json';

function chain(...entries: { path: string; bytes: string }[]): string {
  let text = '';
  for (const entry of entries) {
    const head = readLedger(text).head;
    text += ledgerLine({ head, path: entry.path, bytes: entry.bytes, reason: 'test', now });
  }
  return text;
}

test('a record counts only while its bytes equal the last digest of an intact chain', () => {
  const ledger = readLedger(
    chain({ path: report, bytes: '{"status":"failed"}' }, { path: report, bytes: '{"status":"passed"}' }),
  );
  expect(ledger.problems).toEqual([]);
  expect(recordedEvidence(ledger, report, '{"status":"passed"}')).toBe(true);
  // An edited report, an older content, and a file the chain never saw do not count.
  expect(recordedEvidence(ledger, report, '{"status":"passed" }')).toBe(false);
  expect(recordedEvidence(ledger, report, '{"status":"failed"}')).toBe(false);
  expect(recordedEvidence(ledger, '.agent-logs/review/x.json', '{}')).toBe(false);
});

test('an edited, reordered, removed or forged line breaks the chain, and nothing counts', () => {
  const text = chain(
    { path: report, bytes: 'a' },
    { path: 'b.json', bytes: 'b' },
    { path: 'c.json', bytes: 'c' },
  );
  const lines = text.trimEnd().split('\n');
  const [first = '', second = '', third = ''] = lines;
  const forgedDigest = first.replace(/"digest":"[a-f0-9]{64}"/, `"digest":"${'f'.repeat(64)}"`);
  for (const broken of [
    [forgedDigest, second, third],
    [second, first, third],
    [first, third],
    [first, second, third, 'not json'],
  ]) {
    const ledger = readLedger(`${broken.join('\n')}\n`);
    expect(ledger.problems.length).toBeGreaterThan(0);
    expect(recordedEvidence(ledger, report, 'a')).toBe(false);
  }
});

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('the writer appends the current content and refuses to extend a broken chain', () => {
  const root = mkdtempSync(join(tmpdir(), 'evidence-ledger-'));
  directories.push(root);
  mkdirSync(join(root, '.agent-logs/verification/r1'), { recursive: true });
  writeFileSync(join(root, report), '{"status":"passed"}');
  recordEvidence(root, report, 'verification report');
  expect(recordedEvidence(readRepositoryLedger(root), report, readFileSync(join(root, report)))).toBe(true);
  writeFileSync(join(root, EVIDENCE_LEDGER), `${readFileSync(join(root, EVIDENCE_LEDGER), 'utf8')}{}\n`);
  expect(() => recordEvidence(root, report, 'verification report')).toThrow('is broken');
});
