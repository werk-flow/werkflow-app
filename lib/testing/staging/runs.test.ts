// A staging journey's cleanup removes only rows that carry a run's marks, and the kit prints ids and
// states only. Every id and value here is made up.
import { describe, expect, test } from 'bun:test';

import {
  StagingFailure,
  actorRunId,
  factLine,
  failureText,
  namedStep,
  newRunId,
  originsFact,
  redact,
  runActorEmail,
  runActorsQuery,
  runMemberEmail,
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
  runMarker: runId,
});
const organization = (id: string, name: string, adminId: string): OrganizationRow => ({ id, name, adminId });

test('a run id names its UTC minute and six hex digits, and refuses less randomness', () => {
  expect(newRunId(NOW, 'A1B2C3D4')).toBe('20261126-1600-a1b2c3');
  expect(() => newRunId(NOW, 'a1b2')).toThrow();
  expect(() => newRunId(NOW, 'zzzzzz')).toThrow();
  expect(runOrganizationName(RUN)).toBe('Agenten-Test 20261125-1500-a1b2c3');
  expect(runActorEmail(RUN)).toBe('agent+20261125-1500-a1b2c3@werkflow-agents.test');
});

describe('actor addresses', () => {
  test('an actor that receives no mail keeps the reserved .test domain', () => {
    expect(runActorEmail(RUN).endsWith('.test')).toBe(true);
    expect(actorRunId(runActorEmail(RUN))).toBe(RUN);
  });

  test("an invited member gets Resend's simulated delivery address, one per run and role", () => {
    expect(runMemberEmail(RUN, 'buero')).toBe('delivered+agent-buero-20261125-1500-a1b2c3@resend.dev');
    expect(runMemberEmail(RUN, 'employee')).toBe('delivered+agent-employee-20261125-1500-a1b2c3@resend.dev');
    expect(runMemberEmail(OTHER_RUN, 'buero')).not.toBe(runMemberEmail(RUN, 'buero'));
    expect(() => runMemberEmail('not-a-run', 'buero')).toThrow(StagingFailure);
    for (const role of ['buero', 'employee'] as const)
      expect(actorRunId(runMemberEmail(RUN, role))).toBe(RUN);
  });

  test('no other address names a run: plain simulated addresses, other labels, other roles or domains', () => {
    for (const email of [
      'delivered@resend.dev',
      `delivered+gg-${RUN}@resend.dev`,
      `delivered+agent-admin-${RUN}@resend.dev`,
      `delivered+agent-buero-${RUN}@resend.dev.example`,
      `bounced+agent-buero-${RUN}@resend.dev`,
      `delivered+agent-buero-${RUN}@werkflow-agents.test`,
      `agent+${RUN}@resend.dev`,
      'delivered+agent-buero-20261125-1500-a1b2c@resend.dev',
    ])
      expect(actorRunId(email), email).toBeNull();
  });

  test("the cleanup's DEV read returns a user only when its address is a run address of its own marker", () => {
    const { query, parameters } = runActorsQuery();
    // Each parameter is one run address with `{run}`, which the query fills with the user's own marker.
    expect(parameters.map((address) => address.replace('{run}', RUN))).toEqual([
      runActorEmail(RUN),
      runMemberEmail(RUN, 'buero'),
      runMemberEmail(RUN, 'employee'),
    ]);
    for (const [index] of parameters.entries())
      expect(query).toContain(`replace($${index + 1}, '{run}', run.marker)`);
    expect(query).toContain("run.marker ~ '^20[0-9]{6}-[0-9]{4}-[0-9a-f]{6}$' and email in (");
    // No pattern match: an unmarked look-alike address never leaves the database.
    expect(query).not.toContain(' like ');
  });
});

describe('cleanup selection', () => {
  const actors = [
    actor('actor-old', RUN, OLD),
    actor('actor-fresh', OTHER_RUN, FRESH),
    // A real person on DEV, whatever their address looks like.
    { id: 'person', email: 'agent@werkflow-agents.test', createdAt: OLD, runMarker: null },
    { id: 'partner', email: `agent+${RUN}@partner.example`, createdAt: OLD, runMarker: RUN },
    // A run address someone typed by hand: no marker, or one for another run.
    { id: 'look-alike', email: runActorEmail('20261120-0900-abcdef'), createdAt: OLD, runMarker: null },
    { id: 'wrong-marker', email: runActorEmail('20261120-0900-fedcba'), createdAt: OLD, runMarker: RUN },
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

  test("a run's member is selected by its simulated address and marker, never without the marker", () => {
    const member = {
      id: 'member',
      email: runMemberEmail(OTHER_RUN, 'buero'),
      createdAt: FRESH,
      runMarker: OTHER_RUN,
    };
    const unmarked = { ...member, id: 'unmarked', runMarker: null };
    expect(selectRuns([member, unmarked], organizations, OTHER_RUN, NOW)).toEqual([
      { runId: OTHER_RUN, actorId: 'member', organizationIds: [] },
    ]);
  });

  test('an actor with an unreadable creation time stays', () => {
    expect(selectRuns([actor('actor-odd', RUN, 'yesterday')], organizations, null, NOW)).toEqual([]);
  });
});

describe('printing', () => {
  test('refused origins print as one bounded fact, however long or key-shaped a host is', () => {
    const long = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}`;
    const keyShaped = 'https://sbp-cdn.example';
    for (const origins of [[long], [keyShaped], ['https://pay.google.com', long, keyShaped]]) {
      const fact = originsFact(origins, []);
      expect(fact.length).toBeLessThanOrEqual(240);
      expect(() => factLine('blocked', { origins: fact })).not.toThrow();
    }
    expect(originsFact(['https://pay.google.com', 'https://maps.googleapis.com'], [])).toBe(
      'https://pay.google.com,https://maps.googleapis.com',
    );
  });

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

  test("a browser's or provider's error prints as its action and kind only, the kit's own words redacted", () => {
    const timeout = new Error(
      'locator.click: Timeout 30000ms exceeded.\nCall log:\n  - x-vercel-protection-bypass: made-up',
    );
    timeout.name = 'TimeoutError';
    expect(failureText(timeout, [])).toBe('locator.click failed (TimeoutError)');
    expect(
      failureText(new Error('page.goto: net::ERR_FAILED at https://werkflow.example/private/path'), []),
    ).toBe('page.goto failed (Error)');
    expect(
      failureText(new Error('expect(page).toHaveURL(expected) failed\n\nReceived: https://x.example/a'), []),
    ).toBe('expect(page).toHaveURL failed (Error)');
    expect(failureText(new Error('evaluate: Execution context was destroyed'), [])).toBe(
      'evaluate failed (Error)',
    );
    expect(failureText(new SyntaxError('JSON Parse error: Unexpected identifier "Payer"'), [])).toBe(
      'SyntaxError',
    );
    expect(failureText('a string', [])).toBe('unknown failure');
    expect(
      failureText(new StagingFailure('The DEV read answered 500 for MadeUpPassword-Aa1.'), [
        'MadeUpPassword-Aa1',
      ]),
    ).toBe('The DEV read answered 500 for [redacted].');
  });

  test('a named step fails with its name and the browser action, never the error text', async () => {
    const wait = new Error(
      'expect(page).toHaveURL(expected) failed\n\nReceived: https://checkout.example/c/pay/cs_test_made_up#x',
    );
    wait.name = 'TimeoutError';
    const failure = await namedStep('returned to staging', () => Promise.reject(wait)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StagingFailure);
    expect(failureText(failure, [])).toBe(
      'returned to staging: expect(page).toHaveURL failed (TimeoutError)',
    );
    expect(await namedStep('loaded', () => Promise.resolve('cs_test_made_up'))).toBe('cs_test_made_up');
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
