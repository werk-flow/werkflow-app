// Rule test: a focused acceptance capture goes to Boat when the workstation has a key, stays local
// only when asked or when its world or target lives here, and never turns an unavailable Boat into a
// silent local build: it names the reason and the deliberate local command.
import { expect, test } from 'bun:test';

import {
  captureLocalReason,
  captureOnBoat,
  captureUnavailableNotice,
  isAcceptanceCapture,
} from './capture-on-boat';

test('only a focused audit run whose grep starts with @ACCEPT is a capture', () => {
  expect(isAcceptanceCapture(['iteration', 'audit', '--grep', '@ACCEPT leaver-handover'])).toBe(true);
  expect(isAcceptanceCapture(['iteration', 'audit', '--grep=@ACCEPT'])).toBe(true);
  // The reference spec's tag also holds ACCEPT, and a golden or group run is no capture.
  expect(isAcceptanceCapture(['iteration', 'audit', '--grep', '@AUDIT-VISUAL-ACCEPT'])).toBe(false);
  expect(isAcceptanceCapture(['iteration', 'audit', '--grep', '@ACCEPTED'])).toBe(false);
  expect(isAcceptanceCapture(['iteration', 'golden', '--grep', '@ACCEPT x'])).toBe(false);
  expect(isAcceptanceCapture(['diagnostic', 'audit', '--grep', '@ACCEPT x'])).toBe(false);
  expect(isAcceptanceCapture(['group', 'audit', '--group', 'audit:visual'])).toBe(false);
});

test('a capture may run on Boat unless asked local or bound to this workstation', () => {
  expect(captureLocalReason(['--grep', '@ACCEPT x'], {})).toBeUndefined();
  expect(captureLocalReason(['--grep', '@ACCEPT x'], { WERKFLOW_VERIFY_LOCAL: '1' })).toContain(
    'WERKFLOW_VERIFY_LOCAL',
  );
  expect(captureLocalReason(['--grep', '@ACCEPT x', '--reuse-run', 'run-1'], {})).toContain('retained world');
  expect(captureLocalReason(['--grep', '@ACCEPT x', '--target=cloud'], {})).toContain('DEV');
  expect(captureLocalReason([], { CI: 'true' })).toBe('');
  expect(captureLocalReason([], { WERKFLOW_BOAT_MACHINE: '1' })).toBe('');
});

test('without a usable key the capture reports Boat unavailable instead of running here', async () => {
  const args = ['--grep', '@ACCEPT x'];
  const absent = await captureOnBoat(args, '/nowhere', {}, () => ({ kind: 'absent' }));
  expect(typeof absent === 'object' && absent.unavailable).toContain('no Boat key');
  expect(
    await captureOnBoat(args, '/nowhere', {}, () => ({ kind: 'unusable', reason: 'it expired.' })),
  ).toEqual({ unavailable: 'it expired.' });
  // Asked local, the key is never read.
  const readKey = () => {
    throw new Error('read');
  };
  expect(await captureOnBoat(args, '/nowhere', { WERKFLOW_VERIFY_LOCAL: '1' }, readKey)).toBeUndefined();
});

test('the unavailable notice names the reason and the deliberate local capture', () => {
  const notice = captureUnavailableNotice('Boat answered 503 capacity.', ['--grep', "@ACCEPT it's"]);
  expect(notice).toContain('BOAT IS UNAVAILABLE: Boat answered 503 capacity.');
  expect(notice).toContain('  bun run test:server local');
  expect(notice).toContain(
    `  WERKFLOW_VERIFY_LOCAL=1 bun run test:audit:focused '--grep' '@ACCEPT it'\\''s'`,
  );
});
