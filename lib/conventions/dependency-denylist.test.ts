import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Dependency denylist (AGENTS.md virtue 4): a package that a decision or an
// owner doc bans cannot enter package.json until that doc changes. Each entry
// cites its doc and a sentence from it; the last test fails when the doc drops
// the sentence, so an entry cannot outlive its reason.

const root = resolve(import.meta.dir, '../..');

type Ban = {
  // An exact package name, or a scope prefix ending in `/` that bans the scope.
  readonly names: readonly string[];
  readonly doc: string;
  readonly evidence: string;
  readonly reason: string;
};

const DENYLIST: readonly Ban[] = [
  {
    names: ['sonner', 'react-hot-toast', 'react-toastify', '@radix-ui/react-toast', 'notistack'],
    doc: '.claude/skills/werkflow-design/SKILL.md',
    evidence: 'There are no toasts. Sonner is banned.',
    reason: 'Feedback goes through Banner and the inline states.',
  },
  {
    names: [
      'react-icons',
      '@heroicons/',
      '@tabler/icons-react',
      '@phosphor-icons/',
      '@fortawesome/',
      '@radix-ui/react-icons',
    ],
    doc: '.claude/skills/werkflow-design/SKILL.md',
    evidence: 'Icons: Lucide only.',
    reason: 'Icons come from lucide-react with the global stroke.',
  },
  {
    names: ['convex', '@convex-dev/'],
    doc: 'docs/decisions/0001-infrastructure-stack.md',
    evidence: '**Rejected: Convex.**',
    reason: 'Postgres on Supabase is the database; a change needs a superseding decision.',
  },
  {
    names: ['@clerk/', '@workos-inc/', 'better-auth'],
    doc: 'docs/decisions/0001-infrastructure-stack.md',
    evidence: 'auth re-evaluation decision record',
    reason: 'Supabase Auth stays until an auth re-evaluation decision record replaces it.',
  },
];

// AGENTS.md "Tools, branches and releases": Bun installs from bun.lock.
const FOREIGN_LOCKFILES = ['yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json'];

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
] as const;

type Declaration = { readonly field: string; readonly name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// An override key can carry a version (`pkg@1`) and nest further overrides.
function declarations(field: string, value: unknown): Declaration[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    { field, name: key.replace(/(?<=.)@.*$/, '') },
    ...aliasTarget(field, nested),
    ...declarations(field, nested),
  ]);
}

// `"toast": "npm:react-hot-toast@2"` installs the banned package under another name.
function aliasTarget(field: string, specifier: unknown): Declaration[] {
  if (typeof specifier !== 'string' || !specifier.startsWith('npm:')) return [];
  return [{ field, name: specifier.slice('npm:'.length).replace(/(?<=.)@.*$/, '') }];
}

function matchesBan(name: string, banned: string): boolean {
  return banned.endsWith('/') ? name.startsWith(banned) : name === banned;
}

function deniedDependencies(manifest: Record<string, unknown>): string[] {
  return DEPENDENCY_FIELDS.flatMap((field) => declarations(field, manifest[field])).flatMap(
    ({ field, name }) => {
      const ban = DENYLIST.find((candidate) => candidate.names.some((banned) => matchesBan(name, banned)));
      if (!ban) return [];
      return [`${field}: ${name} is banned by ${ban.doc} ("${ban.evidence}"). ${ban.reason}`];
    },
  );
}

function readManifest(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (!isRecord(parsed)) throw new Error('package.json is not a JSON object');
  return parsed;
}

test('package.json declares no banned dependency', () => {
  expect(
    deniedDependencies(readManifest()),
    'Remove the package, or change the cited doc with the owner first.',
  ).toEqual([]);
});

test('the check flags a planted name in every dependency field', () => {
  const planted = {
    ...readManifest(),
    dependencies: { 'react-hot-toast': '^2.0.0', toast: 'npm:react-hot-toast@2' },
    devDependencies: { '@heroicons/react': '^2.0.0' },
    optionalDependencies: { convex: '^1.0.0' },
    peerDependencies: { 'better-auth': '^1.0.0' },
    overrides: { 'some-package': { '@clerk/nextjs@6': '6.0.0' } },
  };
  expect(deniedDependencies(planted).map((failure) => failure.split(' is banned by ')[0])).toEqual([
    'dependencies: react-hot-toast',
    'dependencies: react-hot-toast',
    'devDependencies: @heroicons/react',
    'optionalDependencies: convex',
    'peerDependencies: better-auth',
    'overrides: @clerk/nextjs',
  ]);
  expect(deniedDependencies(planted)[0]).toContain('.claude/skills/werkflow-design/SKILL.md');
});

test('no lockfile of another package manager sits beside bun.lock', () => {
  const foreign = FOREIGN_LOCKFILES.filter((name) => existsSync(resolve(root, name)));
  expect(foreign, 'AGENTS.md: use Bun and add no other lockfile.').toEqual([]);
});

test('every ban still stands in the doc it cites', () => {
  const unsupported = DENYLIST.filter((ban) => {
    const path = resolve(root, ban.doc);
    return !existsSync(path) || !readFileSync(path, 'utf8').includes(ban.evidence);
  }).map((ban) => `${ban.names.join(', ')}: ${ban.doc} no longer says "${ban.evidence}"`);
  expect(unsupported, 'Drop the entry with its ban, or restore the ban in its doc.').toEqual([]);
});
