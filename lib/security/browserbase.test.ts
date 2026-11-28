import { expect, test } from 'bun:test';

import {
  type Ledger,
  MACHINE_CALL_SHARE,
  apiFailure,
  redirectNote,
  browseEnvironment,
  callsLeft,
  parseLedger,
  planBrowserbase,
  withCall,
} from './browserbase';

const refusalOf = (...argv: string[]): string | undefined => {
  const plan = planBrowserbase(argv);
  return plan.kind === 'refused' ? plan.reason : undefined;
};

test('the key never goes anywhere but Browserbase: --api-key and --base-url refuse every command', () => {
  for (const argv of [
    ['search', 'heat pump subsidy', '--base-url', 'https://collector.example'],
    ['fetch', 'https://example.com', '--base-url=https://collector.example'],
    ['drive', 'open', 'https://example.com', '--api-key', 'x'],
  ])
    expect(refusalOf(...argv), argv.join(' ')).toContain('refused: the wrapper sends the key');
});

test('the driver environment drops every variable that could change what the CLI sends or prints', () => {
  const env = browseEnvironment(
    {
      PATH: '/usr/bin',
      BROWSERBASE_API_KEY: 'bb_live_MadeUp',
      BROWSERBASE_BASE_URL: 'https://collector.example',
      BROWSE_LOAD_DOTENV: '1',
      BB_X: '1',
      STAGEHAND_EXTENSION_ARCHIVE_PATH: '/elsewhere.zip',
      DEBUG: 'true',
      NODE_DEBUG: 'http',
    },
    { daemonDir: '/state/driver', chromePath: undefined },
  );
  expect(env).toEqual({
    PATH: '/usr/bin',
    BROWSE_LOAD_DOTENV: '0',
    BROWSE_DISABLE_UPDATE_CHECK: '1',
    BROWSERBASE_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    BROWSE_DAEMON_DIR: '/state/driver',
  });
  // A caller's own daemon folder could hold another tool's session on a signed-in browser.
  expect(
    browseEnvironment({ BROWSE_DAEMON_DIR: '/tmp/x' }, { daemonDir: '/d', chromePath: undefined })
      .BROWSE_DAEMON_DIR,
  ).toBe('/d');
  expect(browseEnvironment({ CHROME_PATH: '/own' }, { daemonDir: '/d', chromePath: '/pw' }).CHROME_PATH).toBe(
    '/own',
  );
  expect(browseEnvironment({}, { daemonDir: '/d', chromePath: '/pw' }).CHROME_PATH).toBe('/pw');
});

test('a fetched redirect names a public destination without its query, and nothing else', () => {
  const page = 'http://zvshk.de/themen';
  expect(redirectNote(page, 301, { Location: 'https://zvshk.de/' })).toBe(' -> https://zvshk.de/');
  expect(redirectNote(page, 302, { location: '/neu' })).toBe(' -> http://zvshk.de/neu');
  expect(redirectNote(page, 302, { location: 'https://app.werk-flow.app/login' })).toContain('refuses');
  expect(redirectNote(page, 302, { location: 'https://sso.example.com/cb?code=S3cret' })).toContain(
    'withheld',
  );
  expect(redirectNote(page, 302, { location: 'https://example.com/#token=S3cret' })).toContain('withheld');
  expect(redirectNote(page, 200, { location: 'https://example.com/' })).toBe('');
  expect(redirectNote(page, 301, undefined)).toBe('');
});

test('a failed call prints its status and a hint, never its body', () => {
  expect(apiFailure('Search', 402)).toBe(
    "Search failed with HTTP 402. The plan's allocation for this call is spent. Stop the run.",
  );
  expect(apiFailure('Fetch', 500)).toBe('Fetch failed with HTTP 500.');
});

test('public research pages pass; WerkFlow systems, local hosts and other schemes are refused', () => {
  for (const url of [
    'https://www.zvshk.de/',
    'https://werk-flow.app/',
    'https://www.werk-flow.app/preise',
    'https://some-docs.vercel.app/',
    'https://supabase.com/docs',
  ])
    expect(refusalOf('fetch', url), url).toBeUndefined();
  for (const url of [
    'https://app.werk-flow.app/login',
    'https://werkflow-app-git-main-werkflows-projects.vercel.app/login',
    'https://abcdefghijklmnopqrst.supabase.co/rest/v1/',
    'https://0123.eu.r2.cloudflarestorage.com/werkflow-documents-dev/x.pdf',
    'http://localhost:3000',
    'http://127.0.0.1:54321',
    'http://[::1]/',
    'http://intranet/',
    'http://nas.local/',
    'file:///etc/passwd',
    'https://user:pass@example.com/',
    'not a url',
  ])
    expect(refusalOf('fetch', url), url).toBeDefined();
});

test('a search text with personal or system detail is refused before it leaves the machine', () => {
  expect(refusalOf('search', 'Heizungsbauer Betriebssoftware Vergleich 2026')).toBeUndefined();
  expect(refusalOf('search', 'VDE 0100-410 Schutzmaßnahmen')).toBeUndefined();
  expect(refusalOf('search', 'max.mustermann@example.de Auftrag')).toContain('e-mail');
  expect(refusalOf('search', 'Kunde +49 171 2345678')).toContain('phone');
  expect(refusalOf('search', 'Rückruf 0711 1234567')).toContain('phone');
  expect(refusalOf('search', 'DE89 3704 0044 0532 0130 00')).toContain('IBAN');
  expect(refusalOf('search', 'app.werk-flow.app login')).toContain('WerkFlow');
});

test('search becomes one request body; every filter is checked and unreviewed flags refuse', () => {
  expect(
    planBrowserbase([
      'search',
      'Wärmepumpe Förderung 2026',
      '--num-results',
      '5',
      '--include-domains',
      'bafa.de,*.kfw.de,zvshk.de/themen',
      '--start-published-date=2026-01-01',
    ]),
  ).toEqual({
    kind: 'search',
    request: {
      query: 'Wärmepumpe Förderung 2026',
      numResults: 5,
      includeDomains: ['bafa.de', '*.kfw.de', 'zvshk.de/themen'],
      startPublishedDate: '2026-01-01T00:00:00Z',
    },
    output: undefined,
  });
  for (const filter of ['app.werk-flow.app', 'localhost', 'kunde@example.de', 'bafa.de,10.0.0.1'])
    expect(refusalOf('search', 'a', '--exclude-domains', filter), filter).toContain('public hostnames only');
  expect(refusalOf('search', 'a', '--num-results', '26')).toContain('1 to 25');
  for (const flag of ['--mode', '--category', '--objective', '--provider'])
    expect(refusalOf('search', 'a', flag, 'x'), flag).toContain('no flag this command takes');
  expect(refusalOf('search', 'a', 'b')).toContain('exactly one query');
});

test('fetch becomes one raw request; redirects, proxies and formats are not choices', () => {
  expect(planBrowserbase(['fetch', 'https://example.com', '--output', '/tmp/x.html'])).toEqual({
    kind: 'fetch',
    url: 'https://example.com',
    output: '/tmp/x.html',
  });
  for (const flag of ['--allow-redirects', '--proxies', '--format=markdown', '--allow-insecure-ssl'])
    expect(refusalOf('fetch', 'https://example.com', flag), flag).toContain('no flag this command takes');
  expect(refusalOf('fetch', 'https://app.werk-flow.app/')).toContain('WerkFlow app');
});

test('a refusal never repeats the address it refused, so credentials in it stay out of the log', () => {
  const secret = 'S3cretPassw0rd';
  for (const argv of [
    ['fetch', `https://user:${secret}@example.com/`],
    ['drive', 'open', `https://user:${secret}@example.com/`],
    ['search', 'a', '--include-domains', `${secret}@example.com`],
    ['drive', 'open', '--session', 'x', '--bogus', secret],
    ['drive', 'open', `javascript${secret}:alert(1)`],
    ['fetch', 'https://example.com', `--${secret.toLowerCase()}`],
  ])
    expect(refusalOf(...argv), argv[0]).not.toContain(secret);
});

test('drive runs local driver commands only, never a cloud or attached browser', () => {
  expect(planBrowserbase(['drive', 'open', 'https://example.com'])).toEqual({
    kind: 'drive',
    args: ['open', 'https://example.com', '--local'],
  });
  expect(planBrowserbase(['drive', 'snapshot', '--session', 'research'])).toEqual({
    kind: 'drive',
    args: ['snapshot', '--session', 'research'],
  });
  for (const flag of [
    '--remote',
    '--cdp',
    '--auto-connect',
    '--target-id',
    '--chrome-arg',
    '--no-default-chrome-args',
  ])
    expect(refusalOf('drive', 'open', 'https://example.com', flag), flag).toContain(
      'leaves the local browser',
    );
  for (const command of ['cloud', 'functions', 'skills', 'upload', 'cdp', 'eval', 'status'])
    expect(refusalOf('drive', command), command).toContain('driver command');
  expect(refusalOf('drive', 'open', 'https://app.werk-flow.app')).toContain('WerkFlow app');
  expect(refusalOf('drive', 'open', 'https://example.com', '--no-local')).toContain(
    'no flag this command takes',
  );
  // The driver opens only a full URL; a bare host is refused rather than guessed at.
  expect(refusalOf('drive', 'open', 'app.werk-flow.app')).toContain('no URL');
  expect(refusalOf('drive', 'tab', 'new', 'http://localhost:3000')).toContain('local host');
});

test('open and tab new check the URL wherever it stands among the flags', () => {
  expect(refusalOf('drive', 'open', '--session', 'research', 'https://app.werk-flow.app')).toContain(
    'WerkFlow app',
  );
  expect(refusalOf('drive', 'open', '--headed', 'http://127.0.0.1:3000')).toContain('IP address');
  expect(refusalOf('drive', 'tab', 'new', '--session', 'research', 'http://localhost:3000')).toContain(
    'local host',
  );
  expect(refusalOf('drive', 'open', 'https://example.com', 'https://app.werk-flow.app')).toContain(
    'exactly one URL',
  );
  expect(refusalOf('drive', 'open', 'https://example.com', '--wait-for', 'x')).toContain(
    'no flag this command takes',
  );
  expect(
    planBrowserbase(['drive', 'open', '--session', 'research', 'https://example.com', '--timeout', '45000']),
  ).toEqual({
    kind: 'drive',
    args: ['open', '--session', 'research', 'https://example.com', '--timeout', '45000', '--local'],
  });
});

test('a cloud browser is off: its connect URL would sit in a process argument', () => {
  expect(refusalOf('remote', 'open', 'https://example.com')).toContain(
    'commands: quota, search, fetch, drive',
  );
  expect(refusalOf('drive', 'open', 'https://example.com', '--remote')).toContain('leaves the local browser');
});

test('the ledger counts calls over a rolling window and stops at the machine share', () => {
  // The window is 31 days, at least one billing month.
  const window = 31 * 24 * 60 * 60 * 1000;
  const now = 10 * window;
  expect(parseLedger(undefined)).toEqual({ search: [], fetch: [] });
  expect(parseLedger('{"search":[1]}')).toBeUndefined();
  expect(parseLedger('not json')).toBeUndefined();
  let ledger: Ledger = { search: [now - window], fetch: [] };
  expect(callsLeft(ledger, 'search', now)).toBe(MACHINE_CALL_SHARE);
  ledger = withCall(ledger, 'search', now);
  expect(ledger.search).toEqual([now]);
  for (let call = 1; call < MACHINE_CALL_SHARE; call++) ledger = withCall(ledger, 'search', now);
  expect(callsLeft(ledger, 'search', now)).toBe(0);
  expect(callsLeft(ledger, 'fetch', now)).toBe(MACHINE_CALL_SHARE);
});
