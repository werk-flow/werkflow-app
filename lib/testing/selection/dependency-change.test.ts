// A dependency change runs what the packages it moves can break: every group for the app's, the
// browser's or the stack's, a sample for a development tool, Lint and the static gates for lint and types.
import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LINT_AND_TYPE_PACKAGES, lockfileChange, packageJsonChange } from './dependency-change';
import { z } from '@/lib/zod';

const root = resolve(import.meta.dir, '../../..');

// bun.lock is JSON with trailing commas. eslint nests its own `debug`; the app's `debug` is react's.
const lock = (packages: Record<string, string>, devDependencies: Record<string, string> = {}): string => `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "app",
      "dependencies": { "react": "19.0.0", },
      "devDependencies": ${JSON.stringify({ eslint: '^9', supertool: '^6', '@playwright/test': '^1', '@scope/tool': '^1', ...devDependencies })},
    },
  },
  "packages": {
${Object.entries({
  react: 'react@19.0.0", "", { "dependencies": { "debug": "^4" } }',
  debug: 'debug@4.0.0", "", {}',
  eslint: 'eslint@9.0.0", "", { "dependencies": { "debug": "^3", "minimatch": "^9" } }',
  'eslint/debug': 'debug@3.0.0", "", {}',
  minimatch: 'minimatch@9.0.0", "", {}',
  supertool: 'supertool@6.0.0", "", {}',
  '@playwright/test': '@playwright/test@1.62.0", "", { "dependencies": { "playwright": "1.62.0" } }',
  playwright: 'playwright@1.62.0", "", { "dependencies": { "playwright-core": "1.62.0" } }',
  'playwright-core': 'playwright-core@1.62.0", "", {}',
  '@scope/tool': '@scope/tool@1.0.0", "", { "dependencies": { "@scope/helper": "^1" } }',
  '@scope/tool/@scope/helper': '@scope/helper@1.1.0", "", {}',
  '@scope/helper': '@scope/helper@1.0.0", "", {}',
  orphan: 'orphan@1.0.0", "", {}',
  ...packages,
})
  .map(([key, entry]) => `    "${key}": ["${entry}, "sha512-x"],`)
  .join('\n')}
  },
}
`;
const BASE = lock({});
const moved = (key: string, entry: string) => lockfileChange(BASE, lock({ [key]: entry }));

test('a moved package counts by the strongest root package that installs it, nested versions included', () => {
  expect(
    moved('eslint', 'eslint@9.1.0", "", { "dependencies": { "debug": "^3", "minimatch": "^9" } }'),
  ).toEqual({
    effect: 'lint-type',
    reason: 'bun.lock: eslint through lint or type package eslint',
  });
  // eslint's nested debug is eslint's alone; the top-level one is react's.
  expect(moved('eslint/debug', 'debug@3.1.0", "", {}').effect).toBe('lint-type');
  expect(moved('debug', 'debug@4.1.0", "", {}')).toEqual({
    effect: 'every-group',
    reason: 'bun.lock: debug through runtime dependency react',
  });
  expect(moved('playwright-core', 'playwright-core@1.63.0", "", {}').effect).toBe('every-group');
  expect(moved('supertool', 'supertool@6.1.0", "", {}')).toEqual({
    effect: 'tooling',
    reason: 'bun.lock: supertool through development tool supertool',
  });
  // A peer no root lists counts through the package that declares it; one the root lists, by that entry.
  const peerOnly = lock({
    react: 'react@19.0.0", "", { "peerDependencies": { "peer-only": "^1" } }',
    'peer-only': 'peer-only@1.0.0", "", {}',
  });
  expect(lockfileChange(peerOnly, peerOnly.replace('peer-only@1.0.0', 'peer-only@1.1.0')).effect).toBe(
    'every-group',
  );
  // A runtime package's peer counts through it even when the root lists the peer as a lint package,
  // and so does what that peer installs.
  const peerEslint = lock({ react: 'react@19.0.0", "", { "peerDependencies": { "eslint": "^9" } }' });
  for (const [from, to] of [
    ['eslint@9.0.0', 'eslint@9.1.0'],
    ['minimatch@9.0.0', 'minimatch@9.0.1'],
  ] as const)
    expect(lockfileChange(peerEslint, peerEslint.replace(from, to)).effect).toBe('every-group');
  // The parser's unloaded eslint peer is exempt by the package it resolves to, never by its key:
  // another runtime package installed as `@typescript-eslint/parser` loads its eslint peer.
  const aliasedParser = lock({
    '@typescript-eslint/parser': 'runtime-lib@1.0.0", "", { "peerDependencies": { "eslint": "^9" } }',
  }).replace(
    '"dependencies": { "react": "19.0.0", }',
    '"dependencies": { "react": "19.0.0", "@typescript-eslint/parser": "npm:runtime-lib@1.0.0", }',
  );
  expect(lockfileChange(aliasedParser, aliasedParser.replace('eslint@9.0.0', 'eslint@9.1.0')).effect).toBe(
    'every-group',
  );
  // A Playwright package counts by its own name and resolved name, whoever installs it.
  const browserTool = lockfileChange(
    BASE,
    lock({
      '@scope/tool':
        '@scope/tool@1.0.0", "", { "dependencies": { "@scope/helper": "^1", "playwright-chromium": "^1" } }',
      'playwright-chromium': 'playwright-chromium@1.62.0", "", {}',
    }),
  );
  expect(browserTool.effect).toBe('every-group');
  expect(moved('supertool', 'playwright-core@1.63.0", "", {}').effect).toBe('every-group');
  // A scoped package's nested scoped dependency resolves to its own nesting first.
  expect(moved('@scope/tool/@scope/helper', '@scope/helper@1.2.0", "", {}').effect).toBe('tooling');
  expect(moved('@scope/helper', '@scope/helper@1.0.1", "", {}')).toEqual({
    effect: 'every-group',
    reason: 'bun.lock: @scope/helper, which no root package installs',
  });
});

test('a lock that cannot be read, a changed other workspace or an orphan package runs every group', () => {
  expect(lockfileChange(BASE, '{ "packages": ')).toEqual({
    effect: 'every-group',
    reason: 'bun.lock cannot be read',
  });
  expect(moved('orphan', 'orphan@2.0.0", "", {}').effect).toBe('every-group');
  const workspace = BASE.replace(
    '"workspaces": {',
    '"workspaces": {\n    "packages/x": { "dependencies": { "a": "1" } },',
  );
  expect(lockfileChange(BASE, workspace).effect).toBe('every-group');
  // The lock's settings resolve packages too: overrides, patches, its own versions.
  for (const setting of [
    '"overrides": { "debug": "4.2.0" },',
    '"patchedDependencies": { "react@19.0.0": "patches/r.patch" },',
  ])
    expect(lockfileChange(BASE, BASE.replace('"packages": {', `${setting}\n  "packages": {`))).toEqual({
      effect: 'every-group',
      reason: 'bun.lock: its overrides, patches or other settings changed',
    });
  expect(lockfileChange(BASE, BASE.replace('"lockfileVersion": 1', '"lockfileVersion": 2')).effect).toBe(
    'every-group',
  );
  expect(lockfileChange(BASE, BASE)).toEqual({ effect: 'lint-type', reason: 'bun.lock: no package moved' });
  // A package entry of a shape the classifier does not know could hide what it installs.
  for (const entry of [
    'eslint@9.1.0", "", null',
    'eslint@9.1.0", "", { "dependencies": null }',
    'eslint@9.1.0", "", { "dependencies": ["debug"] }',
  ])
    expect([entry, moved('eslint', entry)]).toEqual([
      entry,
      { effect: 'every-group', reason: 'bun.lock cannot be read' },
    ]);
});

test("a root package's range counts by its section, and a package moved into the runtime dependencies runs every group", () => {
  expect(lockfileChange(BASE, lock({}, { eslint: '^9.1' })).effect).toBe('lint-type');
  const manifest = (
    sections: Record<string, Record<string, string>>,
    extra: Record<string, unknown> = {},
  ): string =>
    JSON.stringify({ name: 'app', scripts: { lint: 'bun scripts/lint.ts' }, ...sections, ...extra }, null, 2);
  const before = manifest({
    dependencies: { react: '19.0.0' },
    devDependencies: { eslint: '^9', supertool: '^6' },
  });
  const change = (sections: Record<string, Record<string, string>>, extra?: Record<string, unknown>) =>
    packageJsonChange(before, manifest(sections, extra));
  expect(
    change({ dependencies: { react: '19.0.0' }, devDependencies: { eslint: '^9.1', supertool: '^6' } })
      .effect,
  ).toBe('lint-type');
  expect(
    change({ dependencies: { react: '19.0.0' }, devDependencies: { eslint: '^9', supertool: '^6.1' } })
      .effect,
  ).toBe('tooling');
  // Every `playwright-` package loads in the browser groups, however many hyphens its name has.
  expect(
    change({
      dependencies: { react: '19.0.0' },
      devDependencies: { eslint: '^9', supertool: '^6', 'playwright-aws-lambda': '^0.11' },
    }).effect,
  ).toBe('every-group');
  // An alias counts by its target too.
  expect(
    change({
      dependencies: { react: '19.0.0' },
      devDependencies: { eslint: '^9', supertool: '^6', pw: 'npm:playwright@1.62.0' },
    }).effect,
  ).toBe('every-group');
  expect(
    change({ dependencies: { react: '19.0.0', eslint: '^9' }, devDependencies: { supertool: '^6' } }),
  ).toEqual({
    effect: 'every-group',
    reason: 'package.json: runtime dependency eslint',
  });
  // A runtime dependency counts by its key, whatever its range says.
  expect(
    change({
      dependencies: { react: '19.0.0', 'left-pad': '' },
      devDependencies: { eslint: '^9', supertool: '^6' },
    }),
  ).toEqual({ effect: 'every-group', reason: 'package.json: runtime dependency left-pad' });
  const scripts = packageJsonChange(
    before,
    before.replace('bun scripts/lint.ts', 'bun scripts/lint.ts --fix'),
  );
  expect(scripts).toEqual({ effect: 'tooling', reason: 'package.json: package scripts' });
  for (const key of ['overrides', 'patchedDependencies', 'imports', 'browserslist'])
    expect(
      change(
        { dependencies: { react: '19.0.0' }, devDependencies: { eslint: '^9', supertool: '^6' } },
        { [key]: {} },
      ),
    ).toEqual({ effect: 'every-group', reason: `package.json: package.json key ${key}` });
  expect(packageJsonChange(before, '{')).toEqual({
    effect: 'every-group',
    reason: 'package.json cannot be read',
  });
  expect(packageJsonChange(before, JSON.stringify(JSON.parse(before)))).toEqual({
    effect: 'lint-type',
    reason: 'package.json: no package moved',
  });
});

test("the repository's own lock classifies a moved package by its real installers", () => {
  const real = readFileSync(join(root, 'bun.lock'), 'utf8');
  const bump = (name: string): string => {
    const line = new RegExp(
      `^    "${name.replace('/', '\\/')}": \\["${name.replace('/', '\\/')}@([^"]+)"`,
      'm',
    );
    expect(real).toMatch(line);
    return real.replace(line, (match, version: string) => match.replace(`@${version}"`, `@${version}-next"`));
  };
  expect(lockfileChange(real, bump('eslint-plugin-jsx-a11y')).effect).toBe('lint-type');
  expect(lockfileChange(real, bump('knip')).effect).toBe('lint-type');
  // Runtime packages declare it as a peer, yet a declaration package loads nowhere.
  expect(lockfileChange(real, bump('@types/react'))).toEqual({
    effect: 'lint-type',
    reason: 'bun.lock: @types/react, type declarations only',
  });
  // The quarantine report's parser declares eslint as a peer it never loads (UNLOADED_PEERS).
  const loads = spawnSync(
    'grep',
    ['-rlE', `(require\\(|from )['"]eslint['"/]`, join(root, 'node_modules/@typescript-eslint/parser/dist')],
    { encoding: 'utf8' },
  );
  expect([loads.status, loads.stdout]).toEqual([1, '']);
  expect(lockfileChange(real, bump('eslint')).effect).toBe('lint-type');
  // A package only a runtime dependency installs runs every group.
  expect(lockfileChange(real, bump('@radix-ui/react-primitive')).effect).toBe('every-group');
  expect(lockfileChange(real, bump('next')).effect).toBe('every-group');
  expect(lockfileChange(real, bump('playwright-core')).effect).toBe('every-group');
  expect(lockfileChange(real, bump('tailwindcss')).effect).toBe('every-group');
  expect(lockfileChange(real, bump('fake-indexeddb')).effect).toBe('tooling');
  // Any change to an entry's metadata moves its package, not only its version or dependency maps.
  const bin = '"bin": { "next": "dist/bin/next" }';
  expect(real).toContain(bin);
  expect(lockfileChange(real, real.replace(bin, '"bin": { "next": "dist/bin/next-moved" }'))).toEqual({
    effect: 'every-group',
    reason: 'bun.lock: next through runtime dependency next',
  });
});

test('a lint or type package is loaded only by the lint configuration, its rules, the knip configuration, the static gate scripts and unit tests', () => {
  const allowed = (file: string): boolean =>
    file === 'eslint.config.mjs' ||
    file === 'knip.ts' ||
    file === 'scripts/lint.ts' ||
    file === 'scripts/check-changed.ts' ||
    file.startsWith('eslint-rules/') ||
    /\.test\.[cm]?[jt]sx?$/.test(file);
  const files = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.mjs', '*.js', '*.cjs'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file && !allowed(file));
  const packageOf = (specifier: string): string =>
    specifier
      .split('/')
      .slice(0, specifier.startsWith('@') ? 2 : 1)
      .join('/');
  const loads = files.flatMap((file) => {
    const source = readFileSync(join(root, file), 'utf8');
    const specifiers = [
      ...source.matchAll(
        /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^import\s+)['"]([^'"./][^'"]*)['"]/gm,
      ),
      ...source.matchAll(/node_modules\/(?:\.bin\/)?((?:@[\w.-]+\/)?[\w.-]+)/g),
    ].map((match) => packageOf(match[1] ?? ''));
    return specifiers.filter((name) => LINT_AND_TYPE_PACKAGES.test(name)).map((name) => `${file}: ${name}`);
  });
  expect(loads).toEqual([]);
  // A package script that runs one is a static gate.
  const scripts = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).scripts;
  const runners = Object.entries(scripts)
    .filter(([, command]) => /\b(eslint|knip|typescript7)\b/.test(command))
    .map(([name]) => name);
  expect(runners.sort()).toEqual(['typecheck', 'unused:check', 'unused:production']);
});
