// Rule test: a focused run goes to Boat when it needs the app built at this tree's migrations: a
// capture or a reference update always, any other focused run only under migration drift. It stays
// local only when asked or when its world or target lives here, and never turns an unavailable Boat
// into a silent local build: it names the reason and the deliberate local command.
import { expect, test } from 'bun:test';

import { focusedKind, focusedLocalReason, focusedOnBoat, focusedUnavailableNotice } from './focused-on-boat';

const UPDATE = { WERKFLOW_UPDATE_VISUAL_REFERENCES: '1' };
const drift = {
  stackOnly: [],
  treeOnly: ['20261201090000_zeiterfassung_settings'],
  changed: [],
  unverified: [],
};
const noDrift = { stackOnly: [], treeOnly: [], changed: [], unverified: [] };
const absent = () => ({ kind: 'absent' as const });

test('a capture, a reference update and any other focused audit or golden run are focused kinds', () => {
  expect(focusedKind(['iteration', 'audit', '--grep', '@ACCEPT leaver-handover'], {})).toBe('capture');
  expect(focusedKind(['iteration', 'audit', '--grep=@ACCEPT'], {})).toBe('capture');
  // The reference spec's tag also holds ACCEPT: with the update variable it is an update, else a focused run.
  const references = ['iteration', 'audit', '--grep', '@AUDIT-VISUAL rendered references'];
  expect(focusedKind(references, UPDATE)).toBe('reference-update');
  expect(focusedKind(references, {})).toBe('focused');
  expect(focusedKind(['iteration', 'audit', '--grep', '@ACCEPTED'], {})).toBe('focused');
  // A golden run never updates references; group, diagnostic and direct runs are no focused runs.
  expect(focusedKind(['iteration', 'golden', '--grep', 'P1-07'], UPDATE)).toBe('focused');
  expect(focusedKind(['diagnostic', 'audit', '--grep', '@ACCEPT x'], {})).toBeUndefined();
  expect(focusedKind(['group', 'audit', '--group', 'audit:visual'], UPDATE)).toBeUndefined();
  expect(focusedKind(['iteration', 'canary'], {})).toBeUndefined();
});

test('a focused run may run on Boat unless asked local or bound to this workstation', () => {
  expect(focusedLocalReason(['--grep', '@ACCEPT x'], {})).toBeUndefined();
  expect(focusedLocalReason(['--grep', '@ACCEPT x'], { WERKFLOW_VERIFY_LOCAL: '1' })).toContain(
    'WERKFLOW_VERIFY_LOCAL',
  );
  expect(focusedLocalReason(['--grep', '@ACCEPT x', '--reuse-run', 'run-1'], {})).toContain('retained world');
  expect(focusedLocalReason(['--grep', '@ACCEPT x', '--target=cloud'], {})).toContain('DEV');
  expect(focusedLocalReason([], { CI: 'true' })).toBe('');
  expect(focusedLocalReason([], { WERKFLOW_BOAT_MACHINE: '1' })).toBe('');
});

test('a capture or update always asks Boat; without a usable key it reports Boat unavailable', async () => {
  const neverRead = () => {
    throw new Error('the drift is read only for an ordinary focused run');
  };
  const capture = await focusedOnBoat(
    ['iteration', 'audit', '--grep', '@ACCEPT x'],
    '/nowhere',
    {},
    absent,
    neverRead,
  );
  expect(typeof capture === 'object' && capture.unavailable).toContain('no Boat key');
  const update = await focusedOnBoat(
    ['iteration', 'audit', '--grep', '@AUDIT-VISUAL rendered references'],
    '/nowhere',
    UPDATE,
    () => ({ kind: 'unusable', reason: 'it expired.' }),
    neverRead,
  );
  expect(update).toEqual({ unavailable: 'it expired.' });
  // Asked local, the key is never read.
  const readKey = () => {
    throw new Error('read');
  };
  expect(
    await focusedOnBoat(
      ['iteration', 'audit', '--grep', '@ACCEPT x'],
      '/nowhere',
      { WERKFLOW_VERIFY_LOCAL: '1' },
      readKey,
    ),
  ).toBeUndefined();
});

test('an ordinary focused run goes to Boat only under migration drift, and stays here silently otherwise', async () => {
  const argv = ['iteration', 'golden', '--grep', 'P1-07'];
  const readKey = () => {
    throw new Error('the key is read only when the run goes to Boat');
  };
  expect(await focusedOnBoat(argv, '/nowhere', {}, readKey, () => noDrift)).toBeUndefined();
  // An unreadable stack is no drift: the run stays here, and the local server reports the stack.
  expect(await focusedOnBoat(argv, '/nowhere', {}, readKey, () => undefined)).toBeUndefined();
  // A local reason keeps it here without reading the stack.
  expect(
    await focusedOnBoat([...argv, '--reuse-run', 'run-1'], '/nowhere', {}, readKey, () => {
      throw new Error('read');
    }),
  ).toBeUndefined();
  const drifted = await focusedOnBoat(argv, '/nowhere', {}, absent, () => drift);
  expect(typeof drifted === 'object' && drifted.unavailable).toContain('no Boat key');
});

test('the unavailable notice names the reason and the deliberate local command, the update variable included', () => {
  const capture = focusedUnavailableNotice(
    'Boat answered 503 capacity.',
    ['iteration', 'audit', '--grep', "@ACCEPT it's"],
    {},
  );
  expect(capture).toContain('BOAT IS UNAVAILABLE: Boat answered 503 capacity.');
  expect(capture).toContain('  bun run test:server local');
  expect(capture).toContain(
    `  WERKFLOW_VERIFY_LOCAL=1 bun run test:audit:focused '--grep' '@ACCEPT it'\\''s'`,
  );
  const update = focusedUnavailableNotice(
    'no key.',
    ['iteration', 'audit', '--grep', '@AUDIT-VISUAL rendered references'],
    UPDATE,
  );
  expect(update).toContain(
    `  WERKFLOW_VERIFY_LOCAL=1 WERKFLOW_UPDATE_VISUAL_REFERENCES=1 bun run test:audit:focused '--grep' '@AUDIT-VISUAL rendered references'`,
  );
  expect(focusedUnavailableNotice('no key.', ['iteration', 'golden', '--grep', 'P1-07'], {})).toContain(
    `  WERKFLOW_VERIFY_LOCAL=1 bun run test:golden:focused '--grep' 'P1-07'`,
  );
});
