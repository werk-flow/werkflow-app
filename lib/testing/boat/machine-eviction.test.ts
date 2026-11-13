// Rule test: at the shared machine limit, a run deletes another workstation's kept machine only once
// that machine has waited over 10 minutes and the run took its idle mark; never a machine a run uses,
// never one of its own workstation's, never one kept without a mark (werk-flow/werkflow-planning#415).
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from '../../zod';

import { boatClient } from './boat-api';
import { MARK_IDLE, claimKeptMachine, takeIdleMachineElsewhere, workstationLabel } from './machine-eviction';

const MINE = workstationLabel('this-workstation');
const OTHER = workstationLabel('other-workstation');

type Kept = {
  workstation?: string;
  state?: string;
  archiveAfter?: string;
  /** Seconds since its wipe ended, or undefined while a run uses it or for a machine kept before marks. */
  idleSeconds?: number;
};

/**
 * A Boat stand-in whose machines run each command for real in bash, against a folder of their own
 * in place of /var/lib/werkflow-pristine and without sudo. Answers the files each machine holds.
 */
function fakeBoat(machines: Record<string, Kept>, refuseList = false) {
  const ran: string[] = [];
  const exits: number[] = [];
  const folders = Object.fromEntries(
    Object.entries(machines).map(([id, machine]) => {
      const folder = mkdtempSync(join(tmpdir(), 'boat-pristine-'));
      if (machine.idleSeconds !== undefined) {
        const mark = join(folder, 'idle');
        writeFileSync(mark, '');
        // `find -mmin` measures from the file system's clock, so the age counts from a file written now.
        const at = new Date(statSync(mark).mtimeMs - machine.idleSeconds * 1_000);
        utimesSync(mark, at, at);
      }
      return [id, folder];
    }),
  );
  const client = boatClient('boat_secret', async (url, init) => {
    const { pathname } = new URL(url);
    const method = init?.method ?? 'GET';
    const id = /\/sandboxes\/(bx_\w+)/.exec(pathname)?.[1] ?? '';
    if (method === 'GET' && pathname.endsWith('/sandboxes'))
      return refuseList
        ? Response.json({ code: 'internal' }, { status: 500 })
        : Response.json({
            sandboxes: Object.entries(machines).map(([key, machine]) => ({
              id: key,
              state: machine.state ?? 'idle',
              archiveAfter: machine.archiveAfter ?? null,
              labels: {
                purpose: 'werkflow-verify',
                ...(machine.workstation ? { workstation: machine.workstation } : {}),
              },
            })),
          });
    if (method === 'POST' && pathname.endsWith('/commands')) {
      // The script as bash reads it: runScript sends it as one quoted word after `bash -lc`.
      const { command } = z.object({ command: z.string() }).parse(JSON.parse(String(init?.body)));
      const script = command
        .slice("bash -lc '".length, -1)
        .replaceAll(`'\\''`, "'")
        .replaceAll('/var/lib/werkflow-pristine', folders[id] ?? '/nonexistent')
        .replaceAll('sudo ', '');
      ran.push(id);
      exits.push(Bun.spawnSync(['bash', '-c', script]).exitCode);
      return Response.json({ processId: exits.length - 1 });
    }
    const processId = Number(/\/commands\/(\d+)/.exec(pathname)?.[1]);
    return Response.json({
      status: 'exited',
      running: false,
      exitCode: exits[processId],
      stdout: '',
      stderr: '',
    });
  });
  return { client, ran, folders };
}

const signal = new AbortController().signal;

test("only another workstation's machine idle over 10 minutes is taken, the one Boat stops soonest first", async () => {
  const boat = fakeBoat({
    bx_mine0001: { workstation: MINE, idleSeconds: 3_600 },
    bx_nolabel1: { idleSeconds: 3_600 },
    bx_running1: { workstation: OTHER },
    bx_recent01: { workstation: OTHER, idleSeconds: 540, archiveAfter: '2026-11-13T10:00:00Z' },
    bx_starting: { workstation: OTHER, idleSeconds: 3_600, state: 'provisioning' },
    bx_later001: { workstation: OTHER, idleSeconds: 900, archiveAfter: '2026-11-13T12:00:00Z' },
    bx_sooner01: { workstation: OTHER, idleSeconds: 700, archiveAfter: '2026-11-13T11:00:00Z' },
  });
  expect(await takeIdleMachineElsewhere(boat.client, signal, MINE)).toEqual(['bx_sooner01']);
  // Its own workstation's machines, unlabelled and unready ones are never asked; one is enough.
  expect(boat.ran).toEqual(['bx_recent01', 'bx_sooner01']);
});

test('a machine a run uses, or none waiting long enough, leaves the limit standing', async () => {
  const boat = fakeBoat({
    bx_running1: { workstation: OTHER },
    bx_recent01: { workstation: OTHER, idleSeconds: 599 },
  });
  expect(await takeIdleMachineElsewhere(boat.client, signal, MINE)).toEqual([]);
  expect(await takeIdleMachineElsewhere(fakeBoat({}, true).client, signal, MINE)).toEqual([]);
});

test("a kept machine is its workstation's again only while no evicting run took its mark", async () => {
  const boat = fakeBoat({
    bx_kept0001: { workstation: OTHER, idleSeconds: 700 },
    bx_premark1: { workstation: OTHER },
  });
  expect(await takeIdleMachineElsewhere(boat.client, signal, MINE)).toEqual(['bx_kept0001']);
  // The owner's next run comes too late: the mark is gone, so it starts a new machine instead.
  expect(await claimKeptMachine(boat.client, 'bx_kept0001', signal)).toBe(false);
  // A machine kept before marks existed was never evicted, so its own workstation may take it.
  expect(await claimKeptMachine(boat.client, 'bx_premark1', signal)).toBe(true);
  // And a claimed machine is no longer idle for an evicting run.
  const claimed = fakeBoat({ bx_kept0002: { workstation: OTHER, idleSeconds: 700 } });
  expect(await claimKeptMachine(claimed.client, 'bx_kept0002', signal)).toBe(true);
  expect(await takeIdleMachineElsewhere(claimed.client, signal, MINE)).toEqual([]);
});

test('the idle mark follows only a passed wipe, and the label names no host', () => {
  const folder = mkdtempSync(join(tmpdir(), 'boat-pristine-'));
  const mark = (wipe: string) =>
    Bun.spawnSync([
      'bash',
      '-c',
      `${wipe}${MARK_IDLE.replaceAll('/var/lib/werkflow-pristine', folder).replaceAll('sudo ', '')}`,
    ]);
  const failed = mark('false');
  expect(failed.exitCode, failed.stderr.toString()).toBe(1);
  expect(existsSync(join(folder, 'idle'))).toBe(false);
  const passed = mark('true');
  expect(passed.exitCode, passed.stderr.toString()).toBe(0);
  expect(existsSync(join(folder, 'idle'))).toBe(true);
  expect(workstationLabel('Tamays-MacBook')).toMatch(/^[0-9a-f]{16}$/);
  expect(workstationLabel('Tamays-MacBook')).not.toBe(workstationLabel('werkflow-vm'));
});
