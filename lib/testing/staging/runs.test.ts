// A staging journey's cleanup removes only rows that carry a run's marks, and the kit prints ids and
// states only. Every id and value here is made up.
import { describe, expect, test } from 'bun:test';

import {
  factLine,
  newRunId,
  redact,
  runActorEmail,
  runOrganizationName,
  selectRuns,
  type ActorRow,
  type OrganizationRow,
} from './runs';

const NOW = new Date('2026-11-26T16:00:00Z');
const OLD = '2026-11-25T15:00:00Z';
const FRESH = '2026-11-26T10:00:00Z';
const RUN = '20261125-1500-a1b2c3';
const OTHER_RUN = '20261126-1000-d4e5f6';

const actor = (id: string, runId: string, createdAt: string): ActorRow => ({
  id,
  email: runActorEmail(runId),
  createdAt,
});
const organization = (id: string, name: string, adminId: string): OrganizationRow => ({ id, name, adminId });

test('a run id names its UTC minute and six hex digits, and refuses less randomness', () => {
  expect(newRunId(NOW, 'A1B2C3D4')).toBe('20261126-1600-a1b2c3');
  expect(() => newRunId(NOW, 'a1b2')).toThrow();
  expect(() => newRunId(NOW, 'zzzzzz')).toThrow();
  expect(runOrganizationName(RUN)).toBe('Agenten-Test 20261125-1500-a1b2c3');
  expect(runActorEmail(RUN)).toBe('agent+20261125-1500-a1b2c3@werkflow-agents.test');
});

describe('cleanup selection', () => {
  const actors = [
    actor('actor-old', RUN, OLD),
    actor('actor-fresh', OTHER_RUN, FRESH),
    // A real person on DEV, whatever their address looks like.
    { id: 'person', email: 'agent@werkflow-agents.test', createdAt: OLD },
    { id: 'partner', email: `agent+${RUN}@partner.example`, createdAt: OLD },
  ];
  const organizations = [
    organization('org-run', runOrganizationName(RUN), 'actor-old'),
    organization('org-fresh', runOrganizationName(OTHER_RUN), 'actor-fresh'),
    // Named like a run, but administered by someone else: never selected.
    organization('org-foreign-admin', runOrganizationName(RUN), 'person'),
    // The run's actor administers it, but its name carries another run or none.
    organization('org-other-name', runOrganizationName(OTHER_RUN), 'actor-old'),
    organization('org-partner', 'Willert Haustechnik', 'actor-old'),
  ];

  test('the stale sweep takes runs whose actor is older than a day, with their own organizations', () => {
    expect(selectRuns(actors, organizations, null, NOW)).toEqual([
      { runId: RUN, actorId: 'actor-old', organizationIds: ['org-run'] },
    ]);
  });

  test("a run's own cleanup takes that run at any age, and nothing else", () => {
    expect(selectRuns(actors, organizations, OTHER_RUN, NOW)).toEqual([
      { runId: OTHER_RUN, actorId: 'actor-fresh', organizationIds: ['org-fresh'] },
    ]);
    expect(selectRuns(actors, organizations, '20261126-1200-000000', NOW)).toEqual([]);
  });

  test('an actor with an unreadable creation time stays', () => {
    expect(selectRuns([actor('actor-odd', RUN, 'yesterday')], organizations, null, NOW)).toEqual([]);
  });
});

describe('printing', () => {
  test('a failure line loses every secret, key-shaped word and address', () => {
    const password = 'MadeUpPassword-Aa1';
    const line = redact(
      `fill ${password} for agent+x@werkflow-agents.test with sb_secret_MadeUp_123 and rk_test_MadeUp and MadeUpBypassSecret0123456789abcd`,
      [password, 'MadeUpBypassSecret0123456789abcd'],
    );
    expect(line).toBe('fill [redacted] for [address] with [redacted] and [redacted] and [redacted]');
  });

  test("a failure line is one short line without a URL's query, and redacting it again changes nothing", () => {
    const line = redact(
      'page.goto: net::ERR at https://werkflow.example/auth/callback?code=made-up#token=x\n  call log: payer details',
      [],
    );
    expect(line).toBe('page.goto: net::ERR at https://werkflow.example/auth/callback?[redacted]');
    const long = redact('x'.repeat(500), []);
    expect(long).toHaveLength(240);
    expect(redact(long, [])).toBe(long);
  });

  test('a fact line refuses a value that holds one of the run secrets', () => {
    expect(() =>
      factLine('bypass', { header: 'MadeUpBypassSecret0123456789abcd' }, [
        'MadeUpBypassSecret0123456789abcd',
      ]),
    ).toThrow(/ids and states only/);
  });

  test('a fact line holds ids and states, and refuses an address or a key', () => {
    expect(factLine('dashboard shown', { organization: 'org-1', livemode: false, attempts: 2 })).toBe(
      '[staging] dashboard shown: organization=org-1 livemode=false attempts=2',
    );
    expect(factLine('run')).toBe('[staging] run');
    expect(() => factLine('actor', { email: runActorEmail(RUN) })).toThrow(/ids and states only/);
    expect(() => factLine('key', { value: 'sbp_0a0a0a0a0a' })).toThrow(/ids and states only/);
  });
});
