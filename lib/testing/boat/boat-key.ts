import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { formatBerlinLocalDate } from '../../date-time/berlin';
import type { BoatUnavailable } from './boat-unavailable';

// The workstation's Boat API key: one line in a mode-600 file in a mode-700 folder, with its expiry
// date beside it (docs/technical/boat-verification.md). Only the process that calls Boat reads it;
// agents never do (lib/security/boat-key-access.ts).

const BOAT_KEY_FOLDER = join(homedir(), '.config', 'werkflow');
const KEY_FILE = 'boat-api-key';
const EXPIRY_FILE = 'boat-api-key.expires';
/** Days before expiry when a run starts to remind the owner. */
const EXPIRY_WARNING_DAYS = 14;

export type BoatKeyReading =
  | { kind: 'absent' }
  | { kind: 'unusable'; reason: string }
  | { kind: 'usable'; key: string; expiresOn: string | undefined; reminder: string | undefined };

const RENEW =
  'Renew it in the Boat dashboard (API keys, organization WerkFlow, 90 days, the actions in docs/technical/boat-verification.md) and install it as that doc says.';

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Reads the key, or says why a run cannot use it. `folder` and `now` are a test's stand-ins. */
export function readBoatKey(folder = BOAT_KEY_FOLDER, now = new Date()): BoatKeyReading {
  const keyPath = join(folder, KEY_FILE);
  let key: string;
  try {
    const mode = statSync(keyPath).mode;
    if ((mode & 0o077) !== 0 || (statSync(folder).mode & 0o077) !== 0)
      return {
        kind: 'unusable',
        reason: `the key file or its folder is readable by others; run chmod 700 ${folder} and chmod 600 on the key file.`,
      };
    key = readFileSync(keyPath, 'utf8').trim();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { kind: 'absent' };
    // A key being replaced, or a file this process may not read.
    return { kind: 'unusable', reason: 'the key file could not be read.' };
  }
  if (!/^boat_\S+$/.test(key))
    return { kind: 'unusable', reason: `the key file does not hold one Boat key on one line. ${RENEW}` };
  let expiresOn: string | undefined;
  try {
    expiresOn = readFileSync(join(folder, EXPIRY_FILE), 'utf8').trim();
  } catch {
    expiresOn = undefined;
  }
  if (expiresOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) expiresOn = undefined;
  const today = formatBerlinLocalDate(now);
  if (expiresOn !== undefined && expiresOn <= today)
    return { kind: 'unusable', reason: `the Boat key expired on ${expiresOn}. ${RENEW}` };
  const left = expiresOn === undefined ? undefined : daysBetween(today, expiresOn);
  const reminder =
    left === undefined
      ? `The key has no expiry file; write its expiry date into ${join(folder, EXPIRY_FILE)}.`
      : left <= EXPIRY_WARNING_DAYS
        ? `The Boat key expires on ${expiresOn}, in ${left} days. ${RENEW}`
        : undefined;
  return { kind: 'usable', key, expiresOn, reminder };
}

/** The renewal advice for a key Boat refused. */
export const RENEW_ADVICE = RENEW;

/**
 * Hands the key to `run`, unless `reason` keeps the run on this workstation (printed when not empty)
 * or the key is absent or unusable, which makes Boat unavailable. From the key on, a Ctrl-C stops
 * the run; it never falls back to a local one. `readKey` is a test's stand-in.
 */
export async function withBoatKey<T>(
  reason: string | undefined,
  readKey: () => BoatKeyReading,
  run: (key: string, signal: AbortSignal) => Promise<T | BoatUnavailable | undefined>,
): Promise<T | BoatUnavailable | undefined> {
  if (reason !== undefined) {
    if (reason) console.info(`[verify] Running locally: ${reason}`);
    return undefined;
  }
  const key = readKey();
  if (key.kind === 'absent')
    return {
      unavailable:
        'this workstation has no Boat key (docs/technical/boat-verification.md, "Set up a workstation").',
    };
  if (key.kind === 'unusable') return { unavailable: key.reason };
  if (key.reminder) console.info(`[verify] ${key.reminder}`);
  const interrupt = new AbortController();
  const stop = () => interrupt.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    return await run(key.key, interrupt.signal);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
