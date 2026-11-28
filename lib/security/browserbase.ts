import { z } from '../zod';

// The rules of `bun run browserbase`, the one way agents reach Browserbase
// (.claude/skills/browserbase-research/SKILL.md). The script scripts/browserbase.ts
// does the I/O; this module decides what a call may do. Browserbase's free plan is
// one project with one API key that every machine shares
// (docs/technical/machine-setup.md, "Agent keys"), so the quota is shared too.

export const BROWSERBASE_API = 'https://api.browserbase.com/v1';

/**
 * Each machine's share of the monthly Search and Fetch calls (1,000 each on the free plan, shared by
 * three machines). The API reports no call counts, so each machine counts its own calls over a rolling
 * window at least as long as a billing month; three shares stay below the plan's allocation.
 */
export const MACHINE_CALL_SHARE = 300;
const LEDGER_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

export type CallKind = 'search' | 'fetch';

/** When each counted call ran, in epoch milliseconds. */
export type Ledger = Readonly<Record<CallKind, readonly number[]>>;

const ledgerSchema = z.object({ search: z.array(z.number()), fetch: z.array(z.number()) });

/** The ledger file's text as a ledger: none yet is empty, anything else that does not parse is undefined. */
export function parseLedger(text: string | undefined): Ledger | undefined {
  if (text === undefined) return { search: [], fetch: [] };
  const parsed = z
    .string()
    .transform((json, context) => {
      try {
        return JSON.parse(json);
      } catch {
        context.addIssue({ code: 'custom', message: 'no JSON' });
        return undefined;
      }
    })
    .pipe(ledgerSchema)
    .safeParse(text);
  return parsed.success ? parsed.data : undefined;
}

const inWindow = (times: readonly number[], now: number): number[] =>
  times.filter((time) => time > now - LEDGER_WINDOW_MS && time <= now);

/** How many calls of a kind this machine may still make in the window. */
export function callsLeft(ledger: Ledger, kind: CallKind, now: number): number {
  return Math.max(0, MACHINE_CALL_SHARE - inWindow(ledger[kind], now).length);
}

/** The ledger with one more call of a kind, and calls older than the window dropped. */
export function withCall(ledger: Ledger, kind: CallKind, now: number): Ledger {
  const pruned = { search: inWindow(ledger.search, now), fetch: inWindow(ledger.fetch, now) };
  return { ...pruned, [kind]: [...pruned[kind], now] };
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home.arpa'];

/**
 * Why a URL is no public research target, or undefined when it is one. Refused: any scheme but http
 * and https, credentials in the URL, IP literals, local names, WerkFlow's app and its staging and
 * preview deployments, Supabase projects, and R2 buckets. WerkFlow's public website stays allowed.
 */
function urlRefusal(raw: string): string | undefined {
  const url = URL.parse(raw);
  if (!url) return 'it is no URL';
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'it is no web address';
  if (url.username || url.password) return 'it carries credentials';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || IPV4.test(host)) return 'it names an IP address, not a public host';
  if (
    !host.includes('.') ||
    PRIVATE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  )
    return 'it names a local host';
  if (host.endsWith('.werk-flow.app') && host !== 'www.werk-flow.app') return 'it is a WerkFlow app address';
  if (host.endsWith('.vercel.app') && host.includes('werkflow')) return 'it is a WerkFlow deployment';
  if (host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) return 'it is a Supabase project';
  if (host.endsWith('.r2.cloudflarestorage.com')) return 'it is a storage bucket';
  return undefined;
}

/** Detail a search text must never send to a third party. Each pattern names what it found. */
const PERSONAL_DETAIL: readonly [RegExp, string][] = [
  [/[^\s@]+@[^\s@]+\.[a-z]{2,}/i, 'an e-mail address'],
  [/\b[A-Z]{2}\d{2}\s?(?:[A-Z0-9]{4}\s?){3,7}[A-Z0-9]{1,4}\b/, 'an IBAN'],
  [/(?:\+|\b00)\d{1,3}[\s/-]?\d[\d\s/-]{6,}\d/, 'a phone number'],
  [/\b0\d{2,5}[\s/-]?\d{4,}\b/, 'a phone number'],
  [/werk-flow\.app|werkflow-app-git|supabase\.co\b/i, 'a WerkFlow system address'],
];

/** Why a search text may not leave the machine, or undefined. A backstop: the skill's rule is wider. */
function searchTextRefusal(text: string): string | undefined {
  const found = PERSONAL_DETAIL.find(([pattern]) => pattern.test(text));
  return found ? `it contains ${found[1]}` : undefined;
}

/** The flags a command accepts: those that take a value and those that stand alone. */
type FlagSpec = { values: ReadonlySet<string>; switches: ReadonlySet<string> };

/**
 * Search takes few filters on purpose: each one is text that goes to a third party, so each has a
 * guard. Deep modes, a people category and free-text objectives stay out.
 */
const SEARCH_FLAGS: FlagSpec = {
  values: new Set(['num-results', 'include-domains', 'exclude-domains', 'start-published-date', 'output']),
  switches: new Set(),
};

/** Fetch never follows a redirect, which could lead past the URL guard, and never uses proxies. */
const FETCH_FLAGS: FlagSpec = { values: new Set(['output']), switches: new Set() };

/** `open` and `tab new` name a page, so their flags are listed exactly and their URL is checked. */
const OPEN_FLAGS: FlagSpec = {
  values: new Set(['session', 'timeout', 'wait']),
  switches: new Set(['headed', 'headless', 'local']),
};
const TAB_NEW_FLAGS: FlagSpec = { values: new Set(['session']), switches: new Set() };

/**
 * Driver commands that act on a page already open. Left out: `status` (prints the browser's
 * endpoint), `eval` (runs any script), `cdp`, `daemon`, `doctor`, `network` and `discord`
 * (diagnostics and side channels), `upload` (sends a local file to the page), and every cloud,
 * functions, skills and templates command.
 */
const DRIVER_COMMANDS = new Set([
  'back',
  'click',
  'cursor',
  'fill',
  'forward',
  'get',
  'highlight',
  'is',
  'mouse',
  'open',
  'press',
  'reload',
  'screenshot',
  'select',
  'snapshot',
  'stop',
  'tab',
  'type',
  'viewport',
  'wait',
]);

/**
 * Driver flags no command takes: `--remote` starts a cloud session that records by default, `--cdp`,
 * `--auto-connect` and `--target-id` attach to a browser that may carry someone's sign-ins, and the
 * Chrome flags could swap the browser's temporary profile for a real one. A cloud browser stays off
 * until the driver takes its connect URL other than as a process argument (docs/technical/security.md).
 */
const REFUSED_DRIVER_FLAGS = new Set([
  'remote',
  'cdp',
  'auto-connect',
  'target-id',
  'verified',
  'proxies',
  'chrome-arg',
  'ignore-default-chrome-arg',
  'default-chrome-args',
]);

/** Flags no command takes: the key comes from the key file, and only to Browserbase's own API. */
const REFUSED_EVERYWHERE = new Set(['api-key', 'base-url']);

/** The body of a Browserbase Search request. */
export type SearchRequest = {
  query: string;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
};

/** What `bun run browserbase` does with its arguments. */
export type Plan =
  | { kind: 'refused'; reason: string }
  | { kind: 'quota' }
  /** A counted Search call, which the wrapper sends itself. */
  | { kind: 'search'; request: SearchRequest; output: string | undefined }
  /** A counted raw Fetch call, which the wrapper sends itself. */
  | { kind: 'fetch'; url: string; output: string | undefined }
  /** A driver command on the local browser, without the key. */
  | { kind: 'drive'; args: readonly string[] };

const refusedPlan = (reason: string): Plan => ({ kind: 'refused', reason });

/** A flag's name without its dashes and `=value`, or undefined for a positional argument. */
function flagName(arg: string): string | undefined {
  const match = /^--(?:no-)?([a-z][a-z-]*)(?:=|$)/.exec(arg);
  return match?.[1];
}

/**
 * Splits arguments into positionals and flag values by a spec. A flag outside the spec refuses the
 * call, so a new CLI flag stays unusable until it is reviewed here. A refusal never quotes a value.
 */
function parseFlags(
  args: readonly string[],
  spec: FlagSpec,
): { positionals: string[]; values: Map<string, string> } | { refusal: string } {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    const name = flagName(arg);
    if (name === undefined) {
      if (arg.startsWith('-')) return { refusal: 'an argument is no flag this command takes' };
      positionals.push(arg);
      continue;
    }
    if (spec.switches.has(name) && !arg.includes('=')) continue;
    if (!spec.values.has(name)) return { refusal: 'an argument is no flag this command takes' };
    const split = arg.indexOf('=');
    const value = split >= 0 ? arg.slice(split + 1) : args[++index];
    if (value === undefined) return { refusal: `--${name} needs a value` };
    values.set(name, value);
  }
  return { positionals, values };
}

/** A domain filter entry: a public host, a `*.` wildcard host, or a host with a path prefix. */
const DOMAIN_ENTRY = /^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[\w./-]*)?$/i;

/** The filter's entries, or why one may not leave the machine. A refusal never quotes an entry. */
function domainFilter(flag: string, value: string | undefined): string[] | { refusal: string } | undefined {
  if (value === undefined) return undefined;
  const entries = value.split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    const host = entry.replace(/^\*\./, '').split('/')[0] ?? '';
    if (!DOMAIN_ENTRY.test(entry) || urlRefusal(`https://${host}`) || searchTextRefusal(entry))
      return { refusal: `--${flag} takes public hostnames only` };
  }
  return entries;
}

function planSearch(args: readonly string[]): Plan {
  const parsed = parseFlags(args, SEARCH_FLAGS);
  if ('refusal' in parsed) return refusedPlan(parsed.refusal);
  const [query, ...extra] = parsed.positionals;
  if (!query || extra.length) return refusedPlan('name exactly one query, in quotes');
  const reason = searchTextRefusal(query);
  if (reason) return refusedPlan(`the query goes to a third party, and ${reason}`);
  const request: SearchRequest = { query };
  const count = parsed.values.get('num-results');
  if (count !== undefined) {
    const numResults = Number(count);
    if (!Number.isInteger(numResults) || numResults < 1 || numResults > 25)
      return refusedPlan('--num-results takes 1 to 25');
    request.numResults = numResults;
  }
  for (const [flag, key] of [
    ['include-domains', 'includeDomains'],
    ['exclude-domains', 'excludeDomains'],
  ] as const) {
    const entries = domainFilter(flag, parsed.values.get(flag));
    if (entries !== undefined && 'refusal' in entries) return refusedPlan(entries.refusal);
    if (entries) request[key] = entries;
  }
  const since = parsed.values.get('start-published-date');
  if (since !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) return refusedPlan('--start-published-date takes YYYY-MM-DD');
    request.startPublishedDate = `${since}T00:00:00Z`;
  }
  return { kind: 'search', request, output: parsed.values.get('output') };
}

function planFetch(args: readonly string[]): Plan {
  const parsed = parseFlags(args, FETCH_FLAGS);
  if ('refusal' in parsed) return refusedPlan(parsed.refusal);
  const [url, ...extra] = parsed.positionals;
  if (!url || extra.length) return refusedPlan('name exactly one URL');
  const reason = urlRefusal(url);
  if (reason) return refusedPlan(`the URL is no public research page: ${reason}`);
  return { kind: 'fetch', url, output: parsed.values.get('output') };
}

/** A command that names a page: exactly one URL among its positionals, checked as the driver reads it. */
function planOpen(args: readonly string[], spec: FlagSpec, skip: number): Plan {
  if (args.some((arg) => arg.startsWith('--no-')))
    return refusedPlan('an argument is no flag this command takes');
  const parsed = parseFlags(args.slice(skip), spec);
  if ('refusal' in parsed) return refusedPlan(parsed.refusal);
  const [target, ...extra] = parsed.positionals;
  if (target === undefined || extra.length) return refusedPlan('name exactly one URL');
  // The driver opens only a full URL, so the URL checked is the URL opened.
  const reason = urlRefusal(target);
  if (reason) return refusedPlan(`the URL is no public research page: ${reason}`);
  // `open` always starts or joins a managed local browser, never another kind of session.
  const local = args[0] === 'open' && !args.includes('--local') ? ['--local'] : [];
  return { kind: 'drive', args: [...args, ...local] };
}

function planDrive(args: readonly string[]): Plan {
  const [command, ...rest] = args;
  if (!command || !DRIVER_COMMANDS.has(command))
    return refusedPlan(`drive takes a driver command: ${[...DRIVER_COMMANDS].join(', ')}`);
  for (const arg of rest) {
    const name = flagName(arg);
    if (name !== undefined && REFUSED_DRIVER_FLAGS.has(name))
      return refusedPlan(`--${name} leaves the local browser or its profile`);
  }
  if (command === 'open') return planOpen(args, OPEN_FLAGS, 1);
  if (command === 'tab' && rest[0] === 'new') return planOpen(args, TAB_NEW_FLAGS, 2);
  return { kind: 'drive', args };
}

/** What `bun run browserbase -- <args>` may do. */
export function planBrowserbase(argv: readonly string[]): Plan {
  const flag = argv.map(flagName).find((name) => name !== undefined && REFUSED_EVERYWHERE.has(name));
  if (flag) return refusedPlan(`--${flag} is refused: the wrapper sends the key, and only to Browserbase`);
  const [command = '', ...args] = argv;
  switch (command) {
    case 'quota':
      return args.length ? refusedPlan('quota takes no arguments') : { kind: 'quota' };
    case 'search':
      return planSearch(args);
    case 'fetch':
      return planFetch(args);
    case 'drive':
      return planDrive(args);
    default:
      return refusedPlan('commands: quota, search, fetch, drive');
  }
}

/**
 * Where a fetched redirect points, for the caller to fetch next: only for a 3xx answer, resolved
 * against the page, and only when the URL guard passes it. A query or fragment can carry a code or
 * signed token, so a destination with either is withheld.
 */
export function redirectNote(
  url: string,
  status: number,
  headers: Readonly<Record<string, string>> | undefined,
): string {
  if (status < 300 || status >= 400) return '';
  const location = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'location')?.[1];
  const target = location === undefined ? undefined : URL.parse(location, url);
  if (!target) return '';
  if (urlRefusal(target.href)) return ' -> an address the URL guard refuses';
  if (target.search || target.hash) return ' -> an address with a query or fragment, withheld';
  return ` -> ${target.href}`;
}

/** What a failed Browserbase call prints: its status and what to do, never its body. */
export function apiFailure(what: string, status: number): string {
  const hint =
    status === 401
      ? ' The key was refused; run `bun run agent-access:check`.'
      : status === 402
        ? " The plan's allocation for this call is spent. Stop the run."
        : status === 429
          ? ' The rate limit was hit. Run calls one after another.'
          : '';
  return `${what} failed with HTTP ${status}.${hint}`;
}

/**
 * Variables the CLI reads that could change what it sends or prints: its own, and `DEBUG`, under
 * which its libraries print requests and endpoints.
 */
const CLI_VARIABLE = /^(?:BROWSERBASE_|BROWSE_|BB_|STAGEHAND_|DEBUG$|NODE_DEBUG$)/;

/**
 * The driver's environment: the caller's, without any variable the CLI reads, and the wrapper's own
 * session folder. The driver never gets the key. Update checks, telemetry and `.env` loading are off, so it reads nothing from the checkout.
 */
export function browseEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  options: { daemonDir: string; chromePath: string | undefined },
): Record<string, string> {
  const kept = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !CLI_VARIABLE.test(entry[0]),
  );
  return {
    ...Object.fromEntries(kept),
    BROWSE_LOAD_DOTENV: '0',
    BROWSE_DISABLE_UPDATE_CHECK: '1',
    BROWSERBASE_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    // The wrapper's own sessions only: another tool's driver session may hold a signed-in browser.
    BROWSE_DAEMON_DIR: options.daemonDir,
    ...(options.chromePath && !env.CHROME_PATH ? { CHROME_PATH: options.chromePath } : {}),
  };
}
