// Rule test: a device_open that would boot a simulator or emulator here waits for measured room;
// one that boots nothing, or boots on another device host, passes.
import { expect, test } from 'bun:test';
import { deviceOpenRefusal } from './device-room';
import type { Admission } from './machine-room';

const UDID = 'C4767FE4-F098-4410-8F28-904236A40792';
const SIMULATORS = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-27-2': [
      { udid: UDID, state: 'Booted', name: 'iPhone 18 Pro' },
      { udid: 'OTHER', state: 'Shutdown', name: 'iPhone 18' },
    ],
  },
});

type Output = { status: number | null; stdout: string };
const MISSING: Output = { status: null, stdout: '' };
/** A machine whose `xcrun` and `adb` answer with these outputs; a missing one is a missing tool. */
const machine =
  (outputs: Readonly<Record<string, Output>>) =>
  (command: string, args: readonly string[]): Output =>
    outputs[[command, ...args].join(' ')] ?? MISSING;
const NOTHING_RUNS = machine({
  'xcrun simctl list devices booted -j': { status: 0, stdout: JSON.stringify({ devices: {} }) },
  'adb devices': { status: 0, stdout: 'List of devices attached\n\n' },
});

const FULL: Admission = {
  admitted: false,
  measured: false,
  unwatched: false,
  reason: 'This machine takes no start now: macOS reports memory pressure: warn.',
};
const ROOM: Admission = { admitted: true, measured: true, unwatched: false, reason: 'room' };
const never = (): Admission => {
  throw new Error('a device that boots nothing here measures no room');
};

test('a boot on a machine without room is refused with the reason and the wait command', () => {
  const reason = deviceOpenRefusal({ deviceId: UDID, hostId: 'local' }, NOTHING_RUNS, () => FULL);
  expect(reason).toContain('macOS reports memory pressure: warn.');
  expect(reason).toContain('bun run room --wait device');
  // No host id is this machine.
  expect(deviceOpenRefusal({ platform: 'ios' }, NOTHING_RUNS, () => FULL)).toBeDefined();
  // A machine without simctl or adb still boots through T3, so it is measured too.
  expect(deviceOpenRefusal({ deviceId: UDID }, machine({}), () => FULL)).toBeDefined();
});

test('a boot with room passes', () => {
  expect(deviceOpenRefusal({ deviceId: UDID, hostId: 'local' }, NOTHING_RUNS, () => ROOM)).toBeUndefined();
});

test('opening a booted simulator or a running emulator boots nothing and passes', () => {
  const booted = machine({ 'xcrun simctl list devices booted -j': { status: 0, stdout: SIMULATORS } });
  expect(deviceOpenRefusal({ deviceId: UDID, hostId: 'local' }, booted, never)).toBeUndefined();
  expect(deviceOpenRefusal({ platform: 'ios' }, booted, never)).toBeUndefined();
  // A shut-down simulator boots.
  expect(deviceOpenRefusal({ deviceId: 'OTHER' }, booted, () => FULL)).toBeDefined();

  const emulator = machine({
    'adb devices': { status: 0, stdout: 'List of devices attached\nemulator-5554\tdevice\n\n' },
    'adb -s emulator-5554 emu avd name': { status: 0, stdout: 'Pixel_9\nOK\n' },
  });
  expect(deviceOpenRefusal({ deviceId: 'Pixel_9', platform: 'android' }, emulator, never)).toBeUndefined();
  expect(deviceOpenRefusal({ deviceId: 'emulator-5554' }, emulator, never)).toBeUndefined();
  expect(deviceOpenRefusal({ deviceId: 'Pixel_8', platform: 'android' }, emulator, () => FULL)).toBeDefined();
});

test('a device on another device host costs this machine nothing', () => {
  expect(deviceOpenRefusal({ deviceId: UDID, hostId: 'mac-ssh' }, NOTHING_RUNS, never)).toBeUndefined();
});
