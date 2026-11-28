import { isUuid } from '../validation/uuid';
import { z } from '../zod';

// The rules of `bun run browserbase`, the one way agents reach Browserbase
// (.claude/skills/browserbase-research/SKILL.md). The script scripts/browserbase.ts
// does the I/O; this module decides what a call may do. Browserbase's free plan is
// one project with one API key that every machine shares
// (docs/technical/machine-setup.md, "Agent keys"), so the quota is shared too.

export const BROWSERBASE_API = 'https://api.browserbase.com/v1';

/** The project's monthly browser time on the free plan, and the longest one session may run. */
export const BROWSER_MINUTES_PER_MONTH = 60;
export const SESSION_CAP_MINUTES = 15;

/**
 * Each machine's share of the monthly Search and Fetch calls (1,000 each on the free plan, shared by
 * three machines). The API reports no call counts, so each machine counts its own calls over a rolling
 * window at least as long as a billing month; three shares stay below the plan's allocation.
 */
export const MACHINE_CALL_SHARE = 300;
export const LEDGER_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

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

/** Whether a new remote session fits the month's browser time: a session may run its full cap. */
export function remoteSessionRefusal(browserMinutesUsed: number): string | undefined {
  const left = BROWSER_MINUTES_PER_MONTH - browserMinutesUsed;
  if (left >= SESSION_CAP_MINUTES) return undefined;
  return `only ${Math.max(0, left)} of the month's ${BROWSER_MINUTES_PER_MONTH} browser minutes are left, fewer than one ${SESSION_CAP_MINUTES}-minute session. Use \`drive\` with the local browser.`;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home.arpa'];

/**
 * Why a URL is no public research target, or undefined when it is one. Refused: any scheme but http
 * and https, credentials in the URL, IP literals, local names, WerkFlow's app and its staging and
 * preview deployments, Supabase projects, and R2 buckets. WerkFlow's public website stays allowed.
 */
export function urlRefusal(raw: string): string | undefined {
  const url = URL.parse(raw);
  if (!url) return 'it is no URL';
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `${url.protocol} is no web address`;
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
export function searchTextRefusal(text: string): string | undefined {
  const found = PERSONAL_DETAIL.find(([pattern]) => pattern.test(text));
  return found ? `it contains ${found[1]}` : undefined;
}

/** The flags a command accepts: those that take a value and those that stand alone. */
type FlagSpec = { values: ReadonlySet<string>; switches: ReadonlySet<string> };

const SEARCH_FLAGS: FlagSpec = {
  values: new Set([
    'num-results',
    'provider',
    'mode',
    'output',
    'include-domains',
    'exclude-domains',
    'start-published-date',
    'end-published-date',
    'category',
    'user-location',
    'objective',
    'max-age-hours',
  ]),
  switches: new Set(['excerpts', 'moderation']),
};

/**
 * `--proxies` is left out: the free plan has no proxy bandwidth. `--format` takes only `raw`: the
 * free plan answers 402 to `markdown` and `json`, which Browserbase bills as an extraction.
 */
const FETCH_FLAGS: FlagSpec = {
  values: new Set(['format', 'output']),
  switches: new Set(['allow-redirects', 'allow-insecure-ssl']),
};

/**
 * Driver commands that work on a page already open. Left out: `cdp`, `daemon`, `doctor`, `network`
 * and `discord` (diagnostics and side channels), `upload` (sends a local file to the page), and every
 * cloud, functions, skills and templates command.
 */
const DRIVER_COMMANDS = new Set([
  'back',
  'click',
  'cursor',
  'eval',
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
  'status',
  'stop',
  'tab',
  'type',
  'viewport',
  'wait',
]);

/**
 * Driver flags that would leave the local browser: `--remote` starts a recorded cloud session,
 * `--cdp` and `--auto-connect` attach to a browser that may carry someone's sign-ins.
 */
const REFUSED_DRIVER_FLAGS = new Set(['remote', 'cdp', 'auto-connect', 'verified', 'proxies']);

/** Flags no command takes: the key comes from the key file, and only to Browserbase's own API. */
const REFUSED_EVERYWHERE = new Set(['api-key', 'base-url']);

/** What `bun run browserbase` does with its arguments. */
export type Plan =
  | { kind: 'refused'; reason: string }
  | { kind: 'quota' }
  /** A Browserbase API call through the CLI, with the key, counted when `call` is set. */
  | { kind: 'cloud'; call: CallKind; args: readonly string[] }
  /** A local driver command, without the key. */
  | { kind: 'drive'; args: readonly string[] }
  | { kind: 'remote-open'; url: string; session: string }
  | { kind: 'remote-stop'; sessionId: string; session: string };

const refused = (reason: string): Plan => ({ kind: 'refused', reason });

/** A flag's name without its dashes and `=value`, or undefined for a positional argument. */
function flagName(arg: string): string | undefined {
  const match = /^--(?:no-)?([a-z][a-z-]*)(?:=|$)/.exec(arg);
  return match?.[1];
}

/**
 * Splits arguments into positionals and flag values by a spec. A flag outside the spec refuses the
 * call, so a new CLI flag stays unusable until it is reviewed here.
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
      if (arg.startsWith('-')) return { refusal: `${arg} is no flag this command takes` };
      positionals.push(arg);
      continue;
    }
    if (spec.switches.has(name) && !arg.includes('=')) continue;
    if (!spec.values.has(name)) return { refusal: `--${name} is no flag this command takes` };
    const split = arg.indexOf('=');
    const value = split >= 0 ? arg.slice(split + 1) : args[++index];
    if (value === undefined) return { refusal: `--${name} needs a value` };
    values.set(name, value);
  }
  return { positionals, values };
}

function planSearch(args: readonly string[]): Plan {
  const parsed = parseFlags(args, SEARCH_FLAGS);
  if ('refusal' in parsed) return refused(parsed.refusal);
  const [query, ...extra] = parsed.positionals;
  if (!query || extra.length) return refused('name exactly one query, in quotes');
  for (const [what, text] of [
    ['the query', query],
    ['--objective', parsed.values.get('objective') ?? ''],
  ] as const) {
    const reason = searchTextRefusal(text);
    if (reason) return refused(`${what} goes to a third party, and ${reason}`);
  }
  const mode = parsed.values.get('mode');
  if (mode === 'deep' || mode === 'deep-lite') return refused(`--mode ${mode} is outside the free searches`);
  if (parsed.values.get('category') === 'people') return refused('a people search looks up personal data');
  return { kind: 'cloud', call: 'search', args: ['cloud', 'search', ...args] };
}

function planFetch(args: readonly string[]): Plan {
  const parsed = parseFlags(args, FETCH_FLAGS);
  if ('refusal' in parsed) return refused(parsed.refusal);
  const [url, ...extra] = parsed.positionals;
  if (!url || extra.length) return refused('name exactly one URL');
  const reason = urlRefusal(url);
  if (reason) return refused(`${url} is no public research page: ${reason}`);
  const format = parsed.values.get('format');
  if (format !== undefined && format !== 'raw')
    return refused('--format takes only raw: the free plan has no markdown or JSON extraction');
  // The CLI's default is markdown, which the free plan refuses after counting the call.
  const raw = format === undefined ? ['--format', 'raw'] : [];
  return { kind: 'cloud', call: 'fetch', args: ['cloud', 'fetch', ...args, ...raw] };
}

/** The URL `open` or `tab new` names, with `https://` added as the driver adds it to a bare host. */
function pageUrl(arg: string): string {
  // `localhost:3000` is a host and port, not a scheme.
  return /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(arg) ? arg : `https://${arg}`;
}

function planDrive(args: readonly string[]): Plan {
  const [command, ...rest] = args;
  if (!command || !DRIVER_COMMANDS.has(command))
    return refused(`drive takes a driver command: ${[...DRIVER_COMMANDS].join(', ')}`);
  for (const arg of rest) {
    const name = flagName(arg);
    if (name !== undefined && REFUSED_DRIVER_FLAGS.has(name))
      return refused(`--${name} leaves the local browser; open a cloud browser with \`remote open\``);
  }
  const opens = command === 'open' ? rest[0] : command === 'tab' && rest[0] === 'new' ? rest[1] : undefined;
  const targets = [
    ...(opens !== undefined && flagName(opens) === undefined ? [pageUrl(opens)] : []),
    ...rest.filter((arg) => /^https?:\/\//i.test(arg)),
  ];
  for (const target of targets) {
    const reason = urlRefusal(target);
    if (reason) return refused(`${target} is no public research page: ${reason}`);
  }
  return { kind: 'drive', args };
}

const SESSION_NAME = /^[a-z][a-z0-9-]{0,40}$/;

function planRemote(args: readonly string[]): Plan {
  const [action, target, ...rest] = args;
  let session = 'remote';
  if (rest.length) {
    const [flag, value, ...extra] = rest;
    if (flag !== '--session' || value === undefined || extra.length || !SESSION_NAME.test(value))
      return refused('remote takes only --session <name> after its target');
    session = value;
  }
  if (action === 'open' && target !== undefined) {
    const url = pageUrl(target);
    const reason = urlRefusal(url);
    return reason
      ? refused(`${url} is no public research page: ${reason}`)
      : { kind: 'remote-open', url, session };
  }
  if (action === 'stop' && target !== undefined) {
    if (!isUuid(target)) return refused('remote stop takes the session id that remote open printed');
    return { kind: 'remote-stop', sessionId: target, session };
  }
  return refused('use remote open <url> or remote stop <session id>');
}

/** What `bun run browserbase -- <args>` may do. */
export function planBrowserbase(argv: readonly string[]): Plan {
  const flag = argv.map(flagName).find((name) => name !== undefined && REFUSED_EVERYWHERE.has(name));
  if (flag) return refused(`--${flag} is refused: the wrapper sends the key, and only to Browserbase`);
  const [command = '', ...args] = argv;
  switch (command) {
    case 'quota':
      return args.length ? refused('quota takes no arguments') : { kind: 'quota' };
    case 'search':
      return planSearch(args);
    case 'fetch':
      return planFetch(args);
    case 'drive':
      return planDrive(args);
    case 'remote':
      return planRemote(args);
    default:
      return refused('commands: quota, search, fetch, drive, remote open, remote stop');
  }
}

/** Variables the CLI reads that could redirect the key or change what it sends. */
const CLI_VARIABLE = /^(?:BROWSERBASE_|BROWSE_|BB_)/;

/**
 * The CLI's environment: the caller's, without any variable the CLI reads, then the key only when
 * the call needs it. Update checks, telemetry and `.env` loading are off, so the CLI reads nothing
 * from the checkout and sends nothing but the call.
 */
export function browseEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  options: { key?: string | undefined; chromePath?: string | undefined },
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
    ...(options.key ? { BROWSERBASE_API_KEY: options.key } : {}),
    ...(options.chromePath && !env.CHROME_PATH ? { CHROME_PATH: options.chromePath } : {}),
  };
}
