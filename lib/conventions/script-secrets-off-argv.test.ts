// Rule test: no .github/scripts shell script puts a credential in a program's arguments.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from './product-sources';
import { logicalLines } from './shell-lines';

// Tier 2 for the VM release path (werk-flow/werkflow-planning#517). Any local user of a shared
// runner reads a running program's arguments in /proc/<pid>/cmdline, so a token passed to
// `curl -H` leaks there while a release runs. A secret reaches curl as a config on a file
// descriptor (`--config <(curl_headers <<< "Authorization: Bearer ${TOKEN}")`,
// .github/scripts/curl-headers.sh), and psql through PGPASSWORD. A credential is a variable
// named *_TOKEN, *_SECRET, *_KEY, *_PASSWORD or *_URL, a variable read by indirection
// (`${!name}`), and a variable or array assigned from one of these. It may appear in an
// assignment, an environment prefix, a here-string and the builtins below, none of which runs
// a program with it as an argument.
const SCRIPTS = join(repositoryRoot, '.github/scripts');

const CREDENTIAL_NAME = /^[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|_URL)$/;

const PUBLIC_URLS: Readonly<Record<string, string>> = {
  APP_URL: 'The public address of the app.',
  HEALTH_URL: 'The public address of the health edge function; its token travels in a header.',
  GITHUB_API_URL: 'GitHub’s API address, set by the runner.',
  GITHUB_SERVER_URL: 'GitHub’s web address, set by the runner.',
};

// Builtins run no program, so their arguments never show in /proc.
const BUILTINS = new Set([
  'test',
  '[',
  '[[',
  'printf',
  'echo',
  'read',
  'local',
  'declare',
  'readonly',
  'export',
]);

const REFERENCE = /\$\{?(!?)([A-Za-z_][A-Za-z0-9_]*)/g;
const KEYWORD = /^(?:(?:if|then|elif|else|while|until|do|time|!|\{)\s+)+/;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\+?=("(?:[^"\\]|\\.)*"|'[^']*'|\([^)]*\)?|\S*)\s*/;

function isCredential(name: string, credentials: ReadonlySet<string>): boolean {
  return credentials.has(name) || (CREDENTIAL_NAME.test(name) && !(name in PUBLIC_URLS));
}

function referencesCredential(text: string, credentials: ReadonlySet<string>): string[] {
  return [...text.matchAll(REFERENCE)]
    .filter(([, indirect, name = '']) => indirect === '!' || isCredential(name, credentials))
    .map(([, indirect, name]) => `$${indirect}${name}`);
}

/** A command list, with where its here-string operand stands, or a quoted word. */
type Level = { kind: 'command'; hereString: 'none' | 'before' | 'in' } | { kind: '"' | "'" };

/**
 * The line cut where a command ends: at a pipe, a list operator, or the bounds of a command or
 * process substitution. Inside quotes these characters are argument text, except where a
 * double-quoted `$(` or backtick opens a command. A here-string operand goes to stdin, so it is
 * left out, but a command substituted inside it still counts.
 */
function splitCommands(line: string): string[] {
  const parts: string[] = [];
  const open: Level[] = [{ kind: 'command', hereString: 'none' }];
  let current = '';
  const cut = () => {
    parts.push(current);
    current = '';
  };
  const command = () => open.findLast((level) => level.kind === 'command');
  const keep = (text: string) => {
    if (command()?.hereString === 'none') current += text;
  };
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';
    const pair = line.slice(index, index + 2);
    const level = open.at(-1);
    if (level?.kind === "'") {
      if (character === "'") open.pop();
      keep(character);
      continue;
    }
    if (level?.kind === 'command' && level.hereString !== 'none' && /\s/.test(character)) {
      if (level.hereString === 'in') level.hereString = 'none';
      continue;
    }
    if (level?.kind === 'command' && level.hereString === 'before') level.hereString = 'in';
    if (character === '\\') {
      keep(pair);
      index += 1;
    } else if (pair === '$(' || (level?.kind === 'command' && (pair === '<(' || pair === '>('))) {
      cut();
      open.push({ kind: 'command', hereString: 'none' });
      index += 1;
    } else if (character === '`') cut();
    else if (level?.kind === '"') {
      if (character === '"') open.pop();
      keep(character);
    } else if (line.startsWith('<<<', index) && level) {
      level.hereString = 'before';
      index += 2;
    } else if (character === "'" || character === '"') {
      open.push({ kind: character });
      keep(character);
    } else if (character === ')') {
      cut();
      if (open.length > 1) open.pop();
    } else if (character === ';' || character === '|' || character === '&') {
      cut();
      if (level) level.hereString = 'none';
    } else keep(character);
  }
  cut();
  return parts;
}

/** Each simple command of the script's lines outside comments, with here-strings removed. */
function commands(script: string): { number: number; text: string }[] {
  return logicalLines(script)
    .filter(({ text }) => !text.trimStart().startsWith('#'))
    .flatMap(({ number, text }) =>
      splitCommands(text)
        .map((command) => ({ number, text: command.trim().replace(KEYWORD, '') }))
        .filter((command) => command.text !== ''),
    );
}

/** The command's leading assignments, and the words that follow them. */
function splitAssignments(command: string): { assignments: [string, string][]; rest: string } {
  const assignments: [string, string][] = [];
  let rest = command.replace(/^(?:local|declare|readonly|export)(?:\s+-\w+)*\s+/, '');
  for (let match = ASSIGNMENT.exec(rest); match; match = ASSIGNMENT.exec(rest)) {
    assignments.push([match[1] ?? '', match[2] ?? '']);
    rest = rest.slice(match[0].length);
  }
  return { assignments, rest: command.match(/^(?:local|declare|readonly|export)\b/) ? '' : rest };
}

/** Each `<line>: <program> <credential>` where a credential lands in a program's arguments. */
function credentialArguments(script: string): string[] {
  const parsed = commands(script).map((command) => ({ ...command, ...splitAssignments(command.text) }));
  const credentials = new Set<string>();
  for (let grown = true; grown; ) {
    grown = false;
    for (const { assignments } of parsed)
      for (const [name, value] of assignments)
        if (!credentials.has(name) && referencesCredential(value, credentials).length > 0) {
          credentials.add(name);
          grown = true;
        }
  }
  return parsed.flatMap(({ number, rest }) => {
    const program = rest.split(/\s/)[0] ?? '';
    if (BUILTINS.has(program)) return [];
    return referencesCredential(rest, credentials).map((reference) => `${number}: ${program} ${reference}`);
  });
}

function scriptFindings(): Record<string, string[]> {
  const scripts = readdirSync(SCRIPTS).filter((name) => name.endsWith('.sh'));
  return Object.fromEntries(
    scripts.map((name) => [name, credentialArguments(readFileSync(join(SCRIPTS, name), 'utf8'))]),
  );
}

test('the scan names a credential in a program’s arguments and passes stdin, env and builtins', () => {
  expect(
    credentialArguments(
      [
        'status="$(curl --silent -H "Authorization: Bearer ${VERCEL_TOKEN}" "$url")"',
        'psql "$DEV_DATABASE_URL" --command "select 1"',
        'git clone "https://x-access-token:${GH_TOKEN}@github.com/o/r.git"',
        'value="${!variable:-}"',
        'curl -H "x-health-check-token: $value" \\',
        '  "$APP_URL"',
        'headers=(-H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")',
        'curl "${headers[@]}" "$url"',
        'auth="Bearer $SUPABASE_ACCESS_TOKEN"; curl -H "$auth" "$url"',
        'curl --config <(curl_headers <<< "Authorization: Bearer ${VERCEL_TOKEN}") "${APP_URL}/login"',
        'status="$(printf \'%s\\n\' "x-health-check-token: ${value}" | get)"',
        'PGPASSWORD="$DB_PASSWORD" psql "$address" --command "select 1"',
        'test -n "${VERCEL_TOKEN:-}" || fail "VERCEL_TOKEN is not configured."',
        '# curl -H "Authorization: Bearer $VERCEL_TOKEN"',
        'local secret="$HEALTH_CHECK_TOKEN"',
        'bash health-check.sh prod check endpoint HEALTH_CHECK_TOKEN "$HEALTH_URL"',
        'curl -H "Cookie: locale=de; session=$GH_TOKEN" "$APP_URL"',
        'jq -r \'.a | .b\' "$file"; echo "$(curl -H \'x: y\' "$VERCEL_TOKEN")"',
        'curl -H "x-note: <<< here" -H "Authorization: Bearer $VERCEL_TOKEN" "$url"',
        'jq . <<< "$(curl -H "Authorization: Bearer $GH_TOKEN" "$url")" | sort',
        'read -r token <<< $HEALTH_CHECK_TOKEN; curl "$url"',
      ].join('\n'),
    ),
  ).toEqual([
    '1: curl $VERCEL_TOKEN',
    '2: psql $DEV_DATABASE_URL',
    '3: git $GH_TOKEN',
    '5: curl $value',
    '8: curl $headers',
    '9: curl $auth',
    '17: curl $GH_TOKEN',
    '18: curl $VERCEL_TOKEN',
    '19: curl $VERCEL_TOKEN',
    '20: curl $GH_TOKEN',
  ]);
});

test('no .github/scripts shell script puts a credential in a program’s arguments', () => {
  const findings = Object.entries(scriptFindings()).filter(([, found]) => found.length > 0);
  expect(Object.fromEntries(findings), 'send it with curl_headers or PGPASSWORD').toEqual({});
});

test('every public URL on the list is still read by a script', () => {
  const sources = readdirSync(SCRIPTS)
    .filter((name) => name.endsWith('.sh'))
    .map((name) => readFileSync(join(SCRIPTS, name), 'utf8'))
    .join('\n');
  const stale = Object.keys(PUBLIC_URLS).filter((name) => !new RegExp(`\\$\\{?${name}\\b`).test(sources));
  expect(stale).toEqual([]);
});
