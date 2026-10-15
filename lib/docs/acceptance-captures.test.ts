import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOSED_RECORD_BANNER } from './closed-records';
import {
  findCaptureCitationProblems,
  findCaptureCitations,
  type AcceptanceEntry,
} from './acceptance-captures';

const RUN = '2026-10-09T101500000Z-1a2b3c';
const TEST_ID = 'tests/audit/visual/acceptance.spec.ts › @ACCEPT probe › @ACCEPT probe kunden';
const FILE = 'probe/kunden-375-light.png';
const IMAGE = Buffer.from('png bytes of the capture');
const RECORD = ['docs', 'plans', 'probe-record.md'].join('/');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acceptance-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeRun(input: {
  entryStatus: AcceptanceEntry['status'];
  testStatus: string;
  image?: Buffer;
}): void {
  const directory = join(root, '.agent-logs/playwright-runs', RUN);
  mkdirSync(join(directory, 'acceptance/probe'), { recursive: true });
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({ outcomes: [{ id: TEST_ID, status: input.testStatus }] }),
  );
  const entry: AcceptanceEntry = {
    set: 'probe',
    capture: 'kunden',
    file: FILE,
    testId: TEST_ID,
    route: '/kunden',
    role: 'admin',
    view: 'page',
    width: 375,
    height: 812,
    scheme: 'light',
    sha256: createHash('sha256').update(IMAGE).digest('hex'),
    capturedAt: '2026-10-09T10:15:00.000Z',
    status: input.entryStatus,
  };
  writeFileSync(join(directory, 'acceptance/index.json'), JSON.stringify({ version: 1, entries: [entry] }));
  writeFileSync(join(directory, 'acceptance', FILE), input.image ?? IMAGE);
}

const citing = (prefix = ''): { file: string; markdown: string }[] => [
  {
    // A record's path as check-docs passes it; this fixture record exists only here.
    file: RECORD,
    markdown: `${prefix}| \`capture:${RUN}/probe/kunden-375-light\` | ok |`,
  },
];

test('a citation names its run and its image file', () => {
  expect(findCaptureCitations(citing()[0]?.markdown ?? '')).toEqual([{ line: 1, runKey: RUN, file: FILE }]);
});

test('the capture of a passed test with its captured bytes is evidence', () => {
  writeRun({ entryStatus: 'passed', testStatus: 'passed' });
  expect(findCaptureCitationProblems(root, citing())).toEqual([]);
});

// Planted defects: each is reported, so a record cannot cite a failed or tampered capture.
test('a capture whose test failed is refused', () => {
  writeRun({ entryStatus: 'failed', testStatus: 'failed' });
  expect(findCaptureCitationProblems(root, citing())).toEqual([
    `acceptance-capture: ${RECORD}:1: capture ${FILE} is failed: only the capture of a passed test is evidence`,
  ]);
});

test('a capture whose teardown never ran is refused', () => {
  writeRun({ entryStatus: 'captured', testStatus: 'passed' });
  expect(findCaptureCitationProblems(root, citing())[0]).toContain('is captured');
});

test('an index that claims a pass the manifest does not record is refused', () => {
  writeRun({ entryStatus: 'passed', testStatus: 'failed' });
  expect(findCaptureCitationProblems(root, citing())[0]).toContain('did not pass');
});

test('a changed image is refused', () => {
  writeRun({ entryStatus: 'passed', testStatus: 'passed', image: Buffer.from('another picture') });
  expect(findCaptureCitationProblems(root, citing())[0]).toContain('changed after it was captured');
});

test('a run file that is not JSON is reported, not thrown, and the next citation is still checked', () => {
  writeRun({ entryStatus: 'passed', testStatus: 'passed' });
  const directory = join(root, '.agent-logs/playwright-runs', RUN);
  const twoCitations = [...citing(), ...citing()];
  writeFileSync(join(directory, 'manifest.json'), '{"outcomes": [');
  expect(findCaptureCitationProblems(root, twoCitations)).toEqual([
    `acceptance-capture: ${RECORD}:1: the manifest of run ${RUN} is malformed`,
    `acceptance-capture: ${RECORD}:1: the manifest of run ${RUN} is malformed`,
  ]);
  writeFileSync(join(directory, 'acceptance/index.json'), 'not json');
  expect(findCaptureCitationProblems(root, citing())).toEqual([
    `acceptance-capture: ${RECORD}:1: the acceptance index of run ${RUN} is malformed`,
  ]);
});

test('an unknown run is refused for an open record and ignored for a closed one', () => {
  expect(findCaptureCitationProblems(root, citing())[0]).toContain('is not on this workstation');
  const closed = `# Probe\n\nStatus: closed — 2026-10-09\n\n${CLOSED_RECORD_BANNER}\n\n`;
  expect(findCaptureCitationProblems(root, citing(closed))).toEqual([]);
});
