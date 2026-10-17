import { describe, expect, test } from 'bun:test';
import {
  classifyMechanismToken,
  countMechanisms,
  declaredLintRuleNames,
  declaredSelectorSetNames,
  findEnforcedByProblems,
  findStandardProblems,
  findUnreferencedMechanisms,
  findVirtueAgreementProblems,
  isRuleTest,
  parseMechanismTag,
  readStandardSections,
  readVirtueBlocks,
  TEST_FILE_PATTERN,
  type MechanismResolver,
} from './virtue-standards';

const resolver: MechanismResolver = {
  lintNameExists: (name) => ['ui/no-raw-controls', 'registrySelectors'].includes(name),
  pathExists: (path) => ['lib/ui/field-validation.ts', 'components/ui/', 'lib/a.test.ts'].includes(path),
  groupExists: (id) => ['static:lint', 'sql:security'].includes(id),
  scriptExists: (name) => ['lint', 'test:unit', 'docs:check'].includes(name),
  linkExists: (target) => target === 'technical/security.md',
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

  test('an example starts with an existing path or a resolving link, and a command names a script', () => {
    const problems = findStandardProblems(
      standard({
        Examples: [
          '- `lib/gone.ts`: copy nothing.',
          '- A sentence without a path.',
          '- [security.md](technical/security.md): a link to a doc.',
          '- [gone.md](technical/gone.md#rules): a dead link.',
        ],
        'Verify your work': ['1. Run `bun run no-such-script`.'],
      }),
      resolver,
    );
    expect(problems).toEqual([
      'line 19: bun run no-such-script is not a package.json script',
      'line 23: lib/gone.ts does not exist',
      'line 24: an example starts with the backticked path of an existing file or a link to an existing document',
      'line 26: technical/gone.md does not resolve',
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

  test('reads a jsx-a11y name and a selector set as lint names, and a bare script name as a script', () => {
    const asked: string[] = [];
    const recording: MechanismResolver = {
      ...resolver,
      lintNameExists: (name) => {
        asked.push(name);
        return name === 'jsx-a11y/recommended';
      },
      pathExists: () => true,
    };
    const markdown =
      '- **Enforced by.** Tier 2: `jsx-a11y/recommended`, `jsx-a11y/no-such-rule`, `goneSelectors`, `docs:check`, `gone:check`.';
    expect(findEnforcedByProblems(markdown, recording).map((problem) => problem.token)).toEqual([
      'jsx-a11y/no-such-rule',
      'goneSelectors',
      'gone:check',
    ]);
    expect(asked).toEqual(['jsx-a11y/recommended', 'jsx-a11y/no-such-rule', 'goneSelectors']);
  });

  test('classifies tokens by kind and ignores symbols', () => {
    expect(classifyMechanismToken('bun run docs:check')).toEqual({ kind: 'script', target: 'docs:check' });
    expect(classifyMechanismToken('audit:layout*')).toEqual({ kind: 'group', target: 'audit:layout*' });
    expect(classifyMechanismToken('timeOfDaySelectors')).toEqual({
      kind: 'lint',
      target: 'timeOfDaySelectors',
    });
    expect(classifyMechanismToken('lib/docs/')).toEqual({ kind: 'code', target: 'lib/docs/' });
    expect(classifyMechanismToken('useServerAction')).toBeNull();
  });
});

describe('agreement of an "Enforced by" line with its owner docs', () => {
  const agents = [
    '### 1. UI and UX',
    '',
    '- **Enforced by.** Tier 1: `components/ui/`. Tier 2: `static:lint`, the tests under `lib/ui/`, `audit:layout*`.',
    '- **Owner doc.** The skill (`.claude/skills/x/SKILL.md`), with the `unslop` skill. Start from its [How to work](.claude/skills/x/SKILL.md#how-to-work).',
    '',
    '### 2. Performance',
    '',
    '- **Owner doc.** [Realtime](docs/technical/realtime-and-caching.md) and [performance](docs/technical/performance.md), with [CodeRabbit](docs/technical/coderabbit.md).',
    '',
    '### Keep the blocks in step',
  ].join('\n');
  const owner = (checklist: string[]): string =>
    standard({ Checklist: checklist, Never: ['- Never. [judgment]'] });

  test('reads each block, its tokens and only the docs before ", with"', () => {
    expect(readVirtueBlocks(agents).map((block) => [block.virtue, block.ownerDocs])).toEqual([
      [1, ['.claude/skills/x/SKILL.md']],
      [2, ['docs/technical/realtime-and-caching.md', 'docs/technical/performance.md']],
    ]);
  });

  test('agrees when every token is tagged and every tag is named or covered by a folder, a family or static:lint', () => {
    const [block] = readVirtueBlocks(agents);
    if (block === undefined) throw new Error('no block');
    const markdown = owner([
      '- Controls. [lint `ui/no-raw-controls`, code `components/ui/button.tsx`]',
      '- Fields. [test `lib/ui/field.test.ts`, group `audit:layout:work`]',
    ]);
    expect(findVirtueAgreementProblems(block, [markdown])).toEqual([]);
  });

  test('probe: a retagged item and an untagged line token both fail', () => {
    const [block] = readVirtueBlocks(agents);
    if (block === undefined) throw new Error('no block');
    const markdown = owner([
      '- Controls. [lint `ui/no-raw-controls`, code `components/ui/button.tsx`]',
      '- A new rule. [test `lib/conventions/new.test.ts`]',
    ]);
    expect(findVirtueAgreementProblems(block, [markdown])).toEqual([
      'virtue 1 (AGENTS.md:3) names `lib/ui/`, which no item of its owner docs tags',
      'virtue 1 (AGENTS.md:3) names `audit:layout*`, which no item of its owner docs tags',
      'virtue 1: its owner docs tag test lib/conventions/new.test.ts, which the "Enforced by" line (AGENTS.md:3) neither names nor covers',
    ]);
  });

  test('probe: a plain group covers only itself and its colon family', () => {
    const block = { virtue: 4, line: 9, tokens: ['unit:form'], ownerDocs: [] };
    const tagged = (group: string): string => owner([`- A rule. [group \`${group}\`]`]);
    expect(findVirtueAgreementProblems(block, [tagged('unit:form:fields')])).toEqual([]);
    expect(findVirtueAgreementProblems(block, [tagged('unit:format')])).toHaveLength(2);
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
