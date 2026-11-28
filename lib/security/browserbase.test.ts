import { expect, test } from 'bun:test';

import {
  type Ledger,
  LEDGER_WINDOW_MS,
  MACHINE_CALL_SHARE,
  browseEnvironment,
  callsLeft,
  parseLedger,
  planBrowserbase,
  remoteSessionRefusal,
  searchTextRefusal,
  urlRefusal,
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

test('the CLI environment drops every variable that could redirect the key and adds the key only when asked', () => {
  const env = browseEnvironment(
    {
      PATH: '/usr/bin',
      BROWSERBASE_BASE_URL: 'https://collector.example',
      BROWSE_LOAD_DOTENV: '1',
      BB_X: '1',
    },
    {},
  );
  expect(env).toEqual({
    PATH: '/usr/bin',
    BROWSE_LOAD_DOTENV: '0',
    BROWSE_DISABLE_UPDATE_CHECK: '1',
    BROWSERBASE_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
  });
  expect(browseEnvironment({}, { key: 'k' }).BROWSERBASE_API_KEY).toBe('k');
  expect(browseEnvironment({ CHROME_PATH: '/own' }, { chromePath: '/pw' }).CHROME_PATH).toBe('/own');
  expect(browseEnvironment({}, { chromePath: '/pw' }).CHROME_PATH).toBe('/pw');
});

test('public research pages pass; WerkFlow systems, local hosts and other schemes are refused', () => {
  for (const url of [
    'https://www.zvshk.de/',
    'https://werk-flow.app/',
    'https://www.werk-flow.app/preise',
    'https://some-docs.vercel.app/',
    'https://supabase.com/docs',
  ])
    expect(urlRefusal(url), url).toBeUndefined();
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
    expect(urlRefusal(url), url).toBeDefined();
});

test('a search text with personal or system detail is refused before it leaves the machine', () => {
  expect(searchTextRefusal('Heizungsbauer Betriebssoftware Vergleich 2026')).toBeUndefined();
  expect(searchTextRefusal('VDE 0100-410 Schutzmaßnahmen')).toBeUndefined();
  expect(searchTextRefusal('max.mustermann@example.de Auftrag')).toContain('e-mail');
  expect(searchTextRefusal('Kunde +49 171 2345678')).toContain('phone');
  expect(searchTextRefusal('Rückruf 0711 1234567')).toContain('phone');
  expect(searchTextRefusal('DE89 3704 0044 0532 0130 00')).toContain('IBAN');
  expect(searchTextRefusal('app.werk-flow.app login')).toContain('WerkFlow');
  expect(refusalOf('search', 'Heizlast', '--objective', 'für kunde@example.de')).toContain('--objective');
});

test('search and fetch become counted CLI calls; flags outside the reviewed set refuse', () => {
  expect(planBrowserbase(['search', 'Wärmepumpe Förderung 2026', '--num-results', '5'])).toEqual({
    kind: 'cloud',
    call: 'search',
    args: ['cloud', 'search', 'Wärmepumpe Förderung 2026', '--num-results', '5'],
  });
  expect(planBrowserbase(['fetch', 'https://example.com', '--format=raw'])).toEqual({
    kind: 'cloud',
    call: 'fetch',
    args: ['cloud', 'fetch', 'https://example.com', '--format=raw'],
  });
  // The CLI defaults to markdown, which the free plan refuses after counting the call.
  expect(planBrowserbase(['fetch', 'https://example.com'])).toEqual({
    kind: 'cloud',
    call: 'fetch',
    args: ['cloud', 'fetch', 'https://example.com', '--format', 'raw'],
  });
  expect(refusalOf('search', 'a', '--mode', 'deep')).toContain('outside the free searches');
  expect(refusalOf('search', 'a', '--category', 'people')).toContain('personal data');
  expect(refusalOf('search', 'a', 'b')).toContain('exactly one query');
  expect(refusalOf('fetch', 'https://example.com', '--proxies')).toContain('--proxies');
  for (const format of ['markdown', 'json'])
    expect(refusalOf('fetch', 'https://example.com', '--format', format), format).toContain('only raw');
  expect(refusalOf('fetch', 'https://app.werk-flow.app/')).toContain('WerkFlow app');
});

test('drive runs local driver commands only, never a cloud or attached browser', () => {
  expect(planBrowserbase(['drive', 'open', 'example.com'])).toEqual({
    kind: 'drive',
    args: ['open', 'example.com'],
  });
  expect(planBrowserbase(['drive', 'snapshot', '--session', 'remote'])).toEqual({
    kind: 'drive',
    args: ['snapshot', '--session', 'remote'],
  });
  for (const flag of ['--remote', '--cdp', '--auto-connect'])
    expect(refusalOf('drive', 'open', 'https://example.com', flag), flag).toContain(
      'leaves the local browser',
    );
  for (const command of ['cloud', 'functions', 'skills', 'upload', 'cdp'])
    expect(refusalOf('drive', command), command).toContain('driver command');
  expect(refusalOf('drive', 'open', 'app.werk-flow.app')).toContain('WerkFlow app');
  expect(refusalOf('drive', 'tab', 'new', 'localhost:3000')).toContain('local host');
});

test('remote takes a public page or a session id, and nothing else', () => {
  expect(planBrowserbase(['remote', 'open', 'example.com'])).toEqual({
    kind: 'remote-open',
    url: 'https://example.com',
    session: 'remote',
  });
  const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
  expect(planBrowserbase(['remote', 'stop', id, '--session', 'two'])).toEqual({
    kind: 'remote-stop',
    sessionId: id,
    session: 'two',
  });
  expect(refusalOf('remote', 'open', 'http://localhost')).toContain('local host');
  expect(refusalOf('remote', 'stop', 'abc')).toContain('session id');
  expect(refusalOf('remote', 'open', 'example.com', '--verified')).toContain('--session');
});

test('a remote session starts only while a full session still fits the month', () => {
  expect(remoteSessionRefusal(45)).toBeUndefined();
  expect(remoteSessionRefusal(46)).toContain('only 14 of');
  expect(remoteSessionRefusal(70)).toContain('only 0 of');
});

test('the ledger counts calls over a rolling window and stops at the machine share', () => {
  const now = 10 * LEDGER_WINDOW_MS;
  expect(parseLedger(undefined)).toEqual({ search: [], fetch: [] });
  expect(parseLedger('{"search":[1]}')).toBeUndefined();
  expect(parseLedger('not json')).toBeUndefined();
  let ledger: Ledger = { search: [now - LEDGER_WINDOW_MS], fetch: [] };
  expect(callsLeft(ledger, 'search', now)).toBe(MACHINE_CALL_SHARE);
  ledger = withCall(ledger, 'search', now);
  expect(ledger.search).toEqual([now]);
  for (let call = 1; call < MACHINE_CALL_SHARE; call++) ledger = withCall(ledger, 'search', now);
  expect(callsLeft(ledger, 'search', now)).toBe(0);
  expect(callsLeft(ledger, 'fetch', now)).toBe(MACHINE_CALL_SHARE);
});
