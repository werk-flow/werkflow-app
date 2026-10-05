import { describe, expect, test } from 'bun:test';
import {
  countMechanisms,
  declaredLintRuleNames,
  declaredSelectorSetNames,
  findEnforcedByProblems,
  findStandardProblems,
  findUnreferencedMechanisms,
  isRuleTest,
  parseMechanismTag,
  readStandardSections,
  TEST_FILE_PATTERN,
  type MechanismResolver,
} from './virtue-standards';

const resolver: MechanismResolver = {
  lintNameExists: (name) => ['ui/no-raw-controls', 'registrySelectors'].includes(name),
  pathExists: (path) => ['lib/ui/field-validation.ts', 'components/ui/', 'lib/a.test.ts'].includes(path),
  groupExists: (id) => ['static:lint', 'sql:security'].includes(id),
  scriptExists: (name) => ['lint', 'test:unit', 'docs:check'].includes(name),
};

function standard(overrides: Partial<Record<string, string[]>> = {}): string {
  const sections: Record<string, string[]> = {
    'How to work': ['1. Start from `PageShell` and run `bun run lint` after each screen.'],
    Checklist: ['- A page renders the registry. [lint `ui/no-raw-controls`, test `lib/a.test.ts`]'],
    Never: ['- Disable a submit to show validation. [judgment]'],
    'Verify your work': ['1. Run `bun run lint`. A pass prints nothing.'],
    Examples: ['- `lib/ui/field-validation.ts`: copy the focus order.'],
    ...overrides,
  };
  return [
    '# Owner',
    '',
    'Status: living — last reviewed 2026-10-02',
    ...Object.entries(sections).flatMap(([name, items]) => ['', `## ${name}`, '', ...(items ?? [])]),
  ].join('\n');
}

describe('standard sections', () => {
  test('a complete standard has no problem', () => {
    expect(findStandardProblems(standard(), resolver)).toEqual([]);
  });

  test('reads indented continuation lines into the item and stops at the next heading', () => {
    const markdown = [
      '## Checklist',
      '- First part',
      '  second part. [judgment]',
      '### Group',
      '- Next. [judgment]',
      '## Other',
      '- Not an item.',
    ].join('\n');
    const items = readStandardSections(markdown).get('Checklist');
    expect(items?.map((item) => item.text)).toEqual([
      'First part second part. [judgment]',
      'Next. [judgment]',
    ]);
  });

  test('a tag may close the first line of an item whose indented sub-list follows', () => {
    const checklist = [
      '- Grant explicitly: [group `sql:security`]',
      '  1. Enable RLS.',
      '  2. Add policies.',
    ];
    expect(findStandardProblems(standard({ Checklist: checklist }), resolver)).toEqual([]);
  });

  test('a missing or empty section is a problem', () => {
    const problems = findStandardProblems(standard({ Never: [], Examples: undefined }), resolver);
    expect(problems).toContain('section "## Never" is missing or has no list item');
    expect(problems).toContain('section "## Examples" is missing or has no list item');
  });

  test('a missing "How to work" is a problem, and its steps need no mechanism tag', () => {
    expect(findStandardProblems(standard({ 'How to work': undefined }), resolver)).toEqual([
      'section "## How to work" is missing or has no list item',
    ]);
    const procedure = ['### Add a page', '', '1. Copy an existing page.', '2. Run the fast check.'];
    expect(findStandardProblems(standard({ 'How to work': procedure }), resolver)).toEqual([]);
  });

  test('a checklist item without a tag, or with a tag that names nothing, is a problem', () => {
    const problems = findStandardProblems(
      standard({
        Checklist: [
          '- Every page renders a shell.',
          '- A rule with a gone test. [test `lib/gone.test.ts`]',
          '- A rule with an unknown lint name. [lint `ui/no-such-rule`]',
          '- A rule with an unknown group. [group `sql:nothing`]',
          '- A rule with an unknown kind. [maybe `x`]',
        ],
      }),
      resolver,
    );
    expect(problems).toHaveLength(5);
    expect(problems[0]).toContain('mechanism tag');
    expect(problems[1]).toContain('lib/gone.test.ts does not exist');
    expect(problems[2]).toContain('ui/no-such-rule');
    expect(problems[3]).toContain('sql:nothing');
    expect(problems[4]).toContain('mechanism tag');
  });

  test('an example must start with an existing path and a command must name a script', () => {
    const problems = findStandardProblems(
      standard({
        Examples: ['- `lib/gone.ts`: copy nothing.', '- A sentence without a path.'],
        'Verify your work': ['1. Run `bun run no-such-script`.'],
      }),
      resolver,
    );
    expect(problems).toEqual([
      'line 19: bun run no-such-script is not a package.json script',
      'line 23: an example starts with the backticked path of an existing file',
      'line 24: an example starts with the backticked path of an existing file',
    ]);
  });
});

describe('mechanism tags', () => {
  test('parses several mechanisms and a bare judgment', () => {
    expect(parseMechanismTag('Text. [lint `a/b`, group `sql:security`]')).toEqual([
      { kind: 'lint', target: 'a/b' },
      { kind: 'group', target: 'sql:security' },
    ]);
    expect(parseMechanismTag('Text. [judgment]')).toEqual([{ kind: 'judgment', target: null }]);
  });

  test('a markdown link is not a tag and a kind needs its target', () => {
    expect(parseMechanismTag('See [the doc](x.md)')).toBeNull();
    expect(parseMechanismTag('Text. [lint]')).toBeNull();
  });

  test('counts mechanisms by kind over the checklist and the prohibitions', () => {
    expect(countMechanisms(standard())).toEqual({
      lint: 1,
      test: 1,
      group: 0,
      script: 0,
      code: 0,
      judgment: 1,
    });
  });
});

describe('Enforced by lines', () => {
  test('resolves paths, lint names, groups and scripts and ignores symbols', () => {
    const markdown = [
      '- **Enforced by.** Tier 1: `components/ui/` and `useServerAction`. Tier 2: `ui/no-raw-controls`, `static:lint`, `bun run lint`.',
      '- **Enforced by.** Tier 2: `lib/gone.ts`, `ui/gone-rule`, `sql:gone`, `bun run gone`.',
      '- **Good.** `lib/not-checked-here.ts`.',
    ].join('\n');
    expect(findEnforcedByProblems(markdown, resolver).map((problem) => problem.token)).toEqual([
      'lib/gone.ts',
      'ui/gone-rule',
      'sql:gone',
      'bun run gone',
    ]);
  });
});

describe('mechanism coverage', () => {
  test('reads the rule names of a local plugin', () => {
    const source = [
      'export const uiRules = {',
      '  rules: {',
      "    'label-in-spaced-container': labelRule,",
      "    'no-raw-controls': rawRule,",
      '  },',
      '};',
    ].join('\n');
    expect(declaredLintRuleNames(source)).toEqual(['label-in-spaced-container', 'no-raw-controls']);
  });

  test('reads the selector sets of the ESLint configuration, without composed sets', () => {
    const source = [
      'const channelSelector = {',
      "  selector: 'CallExpression',",
      '};',
      'const authListenerSelector = {',
      '  selector: \'CallExpression[callee.property.name="onAuthStateChange"]\',',
      '};',
      '// Pending state binds to the awaited call.',
      "const pollingSelectors = [{ selector: 'X', message: 'Y' }];",
      'const alwaysOnSelectors = [...authSelectors, ...uuidSelectors];',
      '',
      'const productFiles = [];',
    ].join('\n');
    expect(declaredSelectorSetNames(source)).toEqual([
      'channelSelector',
      'authListenerSelector',
      'pollingSelectors',
    ]);
  });

  test('reports a mechanism that no document names', () => {
    expect(
      findUnreferencedMechanisms(
        ['no-raw-controls', 'lib/conventions/new.test.ts'],
        'uses ui/no-raw-controls',
      ),
    ).toEqual(['lib/conventions/new.test.ts']);
  });

  test('counts TypeScript, TSX and ESM tests as mechanism tests', () => {
    const files = ['eslint-contracts.test.mjs', 'field.test.tsx', 'proxy.test.ts', 'proxy.ts', 'rules.mjs'];
    expect(files.filter((file) => TEST_FILE_PATTERN.test(file))).toEqual([
      'eslint-contracts.test.mjs',
      'field.test.tsx',
      'proxy.test.ts',
    ]);
  });

  test('marks a runner test as a rule test only by its opening line', () => {
    expect(isRuleTest('// Rule test: only a focused run rewrites a reference.\nimport x;')).toBe(true);
    expect(isRuleTest("import { test } from 'bun:test';\n// Rule test: too late.")).toBe(false);
    expect(isRuleTest('// Rule test: \nimport x;')).toBe(false);
    expect(isRuleTest('// A unit test of the runner.\n')).toBe(false);
  });
});
