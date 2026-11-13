import { spawnSync } from 'node:child_process';
import { type Admission, measuredAdmission } from './machine-room';

/**
 * The rule of the device guard (.claude/hooks/refuse-device-without-room.ts):
 * T3's `device_open` boots an iOS Simulator or Android Emulator when it is not
 * running, and a boot plus the web app costs about START_COST.device. On
 * 2026-11-13 one boot on the Mac, at normal memory pressure with 3.1 GB
 * available, took the load to 122 and the pressure to warn
 * (werk-flow/werkflow-app#418), and the heavy-slot gate then held the device
 * check's own build back. So a boot on this machine waits for measured room,
 * as a heavy command does. Opening a device that already runs costs nothing
 * and passes, and so does a device on another device host.
 */

type CommandOutput = { readonly status: number | null; readonly stdout: string };
type Run = (command: string, args: readonly string[]) => CommandOutput;
type DeviceOpen = {
  readonly deviceId?: string | undefined;
  readonly hostId?: string | undefined;
  readonly platform?: string | undefined;
};

function runCommand(command: string, args: readonly string[]): CommandOutput {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
  // A missing tool runs no device of its platform.
  if (result.error) return { status: null, stdout: '' };
  return { status: result.status, stdout: result.stdout };
}

/** The UDIDs of the booted iOS Simulators, from `xcrun simctl list devices booted -j`. */
function bootedSimulators(run: Run): string[] {
  const result = run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
  if (result.status !== 0) return [];
  let listing: unknown;
  try {
    listing = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const runtimes: unknown =
    listing && typeof listing === 'object' ? Reflect.get(listing, 'devices') : undefined;
  if (!runtimes || typeof runtimes !== 'object') return [];
  const udids: string[] = [];
  for (const devices of Object.values(runtimes)) {
    if (!Array.isArray(devices)) continue;
    for (const device of devices) {
      const udid: unknown = device && typeof device === 'object' ? Reflect.get(device, 'udid') : undefined;
      const state: unknown = device && typeof device === 'object' ? Reflect.get(device, 'state') : undefined;
      if (typeof udid === 'string' && state === 'Booted') udids.push(udid);
    }
  }
  return udids;
}

/** Each running Android Emulator's serial and AVD name, from `adb devices` and `adb emu avd name`. */
function runningEmulators(run: Run): string[] {
  const result = run('adb', ['devices']);
  if (result.status !== 0) return [];
  const names: string[] = [];
  for (const line of result.stdout.split('\n')) {
    const serial = /^(emulator-\d+)\s+device\b/.exec(line.trim())?.[1];
    if (!serial) continue;
    names.push(serial);
    const avd = run('adb', ['-s', serial, 'emu', 'avd', 'name']);
    const name = avd.status === 0 ? avd.stdout.split('\n')[0]?.trim() : undefined;
    if (name) names.push(name);
  }
  return names;
}

/** Whether the opened device already runs here, so opening it boots nothing. */
function alreadyRunning(open: DeviceOpen, run: Run): boolean {
  const ios = open.platform === 'android' ? [] : bootedSimulators(run);
  const android = open.platform === 'ios' ? [] : runningEmulators(run);
  if (open.deviceId) return ios.includes(open.deviceId) || android.includes(open.deviceId);
  // Without an id T3 picks a device of the platform, and picks a running one when it can.
  return ios.length > 0 || android.length > 0;
}

/**
 * Why `device_open` with this input must wait, or undefined when it may go:
 * on another device host, for a device that already runs, or when this
 * machine has room for a boot.
 */
export function deviceOpenRefusal(
  open: DeviceOpen,
  run: Run = runCommand,
  admit: () => Admission = () => measuredAdmission('device'),
): string | undefined {
  if (open.hostId !== undefined && open.hostId !== 'local') return undefined;
  if (alreadyRunning(open, run)) return undefined;
  const verdict = admit();
  if (verdict.admitted) return undefined;
  return `Refused: opening this device boots a simulator or emulator, and this machine has no room for it. ${verdict.reason} Run \`bun run room --wait device\`, then open it again. Shut a device down when its check ends (\`xcrun simctl shutdown <udid>\`, \`adb -s <serial> emu kill\`).`;
}
