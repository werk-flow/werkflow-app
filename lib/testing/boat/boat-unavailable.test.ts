// Rule test: a connection that fails on the way to Boat before a machine exists gets fresh
// attempts, Boat's own refusal gets none, and an unavailable Boat never sends type-aware lint or a
// browser group to this workstation by default: they are named, priced and recorded blocked.
import { expect, test } from 'bun:test';

import { BoatError, boatClient } from './boat-api';
import { createMachine } from './boat-machine';
import { retryingStart, unavailableNotice } from './boat-unavailable';
import { heldBackHere, unavailable, verifyOnBoat } from './verify-on-boat';

/** Bun's fetch error for a refused or unroutable connection, as the 2026-11-09 run logged it. */
const refused = () =>
  Object.assign(new TypeError('ECONNREFUSED: Unable to connect. Is the computer able to access the url?'), {
    code: 'ECONNREFUSED',
  });

/** A Boat whose machine creation answers each POST with `answers`' next entry; reads say ready. */
function boatAnswering(answers: (() => Response)[]) {
  const creations: (string | null)[] = [];
  const client = boatClient('boat_secret', async (_url, init) => {
    if (init?.method === 'POST') {
      creations.push(new Headers(init.headers).get('idempotency-key'));
      const answer = answers.shift();
      if (!answer) throw new Error('no answer left');
      return answer();
    }
    return Response.json({ sandbox: { id: 'bx_test', state: 'ready' } });
  });
  return { client, creations };
}

async function start(answers: (() => Response)[]) {
  const { client, creations } = boatAnswering(answers);
  const waits: number[] = [];
  const lines: string[] = [];
  const signal = new AbortController().signal;
  const context = {
    signal,
    log: (line: string) => lines.push(line),
    wait: async (milliseconds: number) => {
      waits.push(milliseconds);
    },
  };
  const outcome = await createMachine(retryingStart(client, context), {
    from: 'werkflow-verify',
    name: 'verify-test',
    ttlSeconds: 60,
    purpose: 'run',
    log: () => undefined,
  }).catch((error: unknown) => error);
  return { outcome, creations, waits, lines, signal };
}

test('a refused connection before a machine exists gets a fresh attempt with the same idempotency key', async () => {
  const { outcome, creations, waits, lines } = await start([
    () => {
      throw refused();
    },
    () => Response.json({ sandbox: { id: 'bx_test', state: 'provisioning' } }),
  ]);
  expect(outcome).toMatchObject({ id: 'bx_test' });
  // The same key on both requests: a request that reached Boat before its connection failed starts no second machine.
  expect(creations).toHaveLength(2);
  expect(creations[0]).toBeTruthy();
  expect(creations[1]).toBe(creations[0]);
  expect(waits).toEqual([10_000]);
  expect(lines).toEqual(['Starting a Boat machine failed (ECONNREFUSED); attempt 2 of 3 in 10 s.']);
});

test('a network that stays down ends after three attempts over 30 s with the connection failure as the reason', async () => {
  const { outcome, creations, waits, signal } = await start(
    Array.from({ length: 3 }, () => () => {
      throw refused();
    }),
  );
  expect(creations).toHaveLength(3);
  expect(waits).toEqual([10_000, 20_000]);
  expect(unavailable(outcome, signal)).toEqual({
    unavailable: 'ECONNREFUSED: Unable to connect. Is the computer able to access the url?',
  });
});

test("Boat's own refusal is never retried", async () => {
  for (const [status, code] of [
    [401, 'api_key_invalid'],
    [403, 'api_key_expired'],
    [429, 'member_limit_reached'],
    [503, 'no_ready_machine'],
  ] as const) {
    const { outcome, creations, waits } = await start([() => Response.json({ code }, { status })]);
    expect(outcome instanceof BoatError && [outcome.status, outcome.code], code).toEqual([status, code]);
    expect(creations, code).toHaveLength(1);
    expect(waits, code).toEqual([]);
  }
});

test('no key and an unusable key make Boat unavailable instead of a silent local run', async () => {
  expect(await verifyOnBoat([], '/nowhere', {}, () => ({ kind: 'absent' }))).toEqual({
    unavailable:
      'this workstation has no Boat key (docs/technical/boat-verification.md, "Set up a workstation").',
  });
  const expired = 'the Boat key expired on 2026-11-08. Renew it.';
  expect(await verifyOnBoat([], '/nowhere', {}, () => ({ kind: 'unusable', reason: expired }))).toEqual({
    unavailable: expired,
  });
  // CI and an explicit local run stay whole local runs; neither reads the key.
  const unread = () => {
    throw new Error('the key was read');
  };
  expect(await verifyOnBoat([], '/nowhere', { CI: 'true' }, unread)).toBeUndefined();
  expect(await verifyOnBoat([], '/nowhere', { WERKFLOW_VERIFY_LOCAL: '1' }, unread)).toBeUndefined();
});

const PLAN = [
  'static:format',
  'static:lint',
  'unit:all',
  'sql:security',
  'ui:contracts',
  'golden:p1-01',
  'audit:lab:office',
  'audit:visual',
  'audit:performance:calendar',
];

const timedHeldBack = (id: string): boolean => heldBackHere(id, false);

test('without Boat only the cheap and the wall-clock groups run here; lint and every browser group are held back', () => {
  expect(PLAN.filter(timedHeldBack)).toEqual([
    'static:lint',
    'ui:contracts',
    'golden:p1-01',
    'audit:lab:office',
    'audit:visual',
  ]);
});

test('an untimed wall-clock group is a browser group like any other and stays held back', () => {
  expect(heldBackHere('audit:performance:calendar', true)).toBe(true);
  expect(heldBackHere('unit:all', true)).toBe(false);
});

test('every unavailability names its reason, the held-back groups and their cost, and the deliberate local run', () => {
  const reasons = [
    'this workstation has no Boat key (docs/technical/boat-verification.md, "Set up a workstation").',
    'the Boat key expired on 2026-11-08. Renew it.',
    unavailable(new BoatError(503, 'no_ready_machine', ''), new AbortController().signal).unavailable,
    unavailable(refused(), new AbortController().signal).unavailable,
    'the untracked file .npmrc may hold a credential or a local setting, which Boat never gets.',
    'the Boat machine ran out of memory.',
  ];
  for (const reason of reasons) {
    const notice = unavailableNotice(reason, PLAN.filter(timedHeldBack), ['--group', PLAN.join(',')]);
    expect(notice[1], reason).toBe(`BOAT IS UNAVAILABLE: ${reason}`);
    expect(notice, reason).toContain(
      '  static:lint: type-aware lint, 170 to 370 s at up to 4.1 GiB on an idle PC',
    );
    expect(notice, reason).toContain(
      '  golden:p1-01: a production build at up to 2.9 GiB, then the stack and a browser',
    );
    expect(notice.join('\n'), reason).toContain('This run cannot pass: it exits 1');
    expect(notice, reason).toContain(
      `  WERKFLOW_VERIFY_LOCAL=1 bun run test:verify '--group' '${PLAN.join(',')}'`,
    );
  }
  // A plan of cheap groups loses nothing: one line names the reason.
  expect(unavailableNotice(reasons[0] ?? '', [], [])).toEqual([
    `Boat is unavailable: ${reasons[0]} The plan runs only cheap groups, here.`,
  ]);
});
