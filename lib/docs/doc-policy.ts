// The numbers and exemptions of the documentation rules. A budget or an exemption changes only by
// the owner's decision, recorded as a dated amendment to docs/decisions/0004-documentation-structure.md
// that carries the full settings table; doc-policy.test.ts fails while this file and the latest
// table disagree. The reasons live in that table, not here.

/** Word budgets, counted like `wc -w`. */
const WORD_BUDGETS = {
  livingTechnicalDoc: 4000,
  agentsFile: 2800,
  docsIndex: 3600,
  skillFile: 4000,
} as const;

/** Living technical docs without a word budget. */
const UNBUDGETED_DOCS: readonly string[] = ['docs/technical/test-incident-log.md'];

/** The word budget of a file by its repository path, or null when none applies. */
export function wordBudgetOf(path: string, living: boolean): number | null {
  if (path === 'AGENTS.md') return WORD_BUDGETS.agentsFile;
  if (path === 'docs/README.md') return WORD_BUDGETS.docsIndex;
  // The .agents mirror equals the .claude tree byte for byte, so the .claude copy stands for both.
  if (/^\.claude\/skills\/.+\.md$/.test(path)) return WORD_BUDGETS.skillFile;
  if (living && path.startsWith('docs/technical/') && !UNBUDGETED_DOCS.includes(path))
    return WORD_BUDGETS.livingTechnicalDoc;
  return null;
}

/** Living docs that may carry dates anywhere: dated logs and dated research snapshots. */
export const DATED_DOCS: readonly string[] = [
  'docs/technical/test-incident-log.md',
  'docs/plans/phase-1/log.md',
  'docs/plans/phase-1/audits/golden-gate-log.md',
  'docs/product/competitive-landscape.md',
  'docs/features/commercial-and-finance.md',
];

/** Living docs that may carry dates only on the lines a pattern matches. */
export const DATED_LINES: Readonly<Record<string, RegExp>> = {
  // A complete slice row names its acceptance date, which the roadmap check matches with the record.
  'docs/plans/phase-1/roadmap.md': /^\| `P1-\d{2}a?` \| `complete` \|/,
  // A flow's text is pinned by its hash in the coverage map and changes only with its evidence.
  'docs/product/user-flow-catalog.md': /^- `P1-\d{2}a?-F\d{2,3}` /,
  // A credential row names the day its token expires in its fourth column, which no provider shows
  // where the secret is stored.
  'docs/technical/environments.md': /^\| `[A-Z0-9_]+`[^|]* \|[^|]+\|[^|]+\| \d{4}-\d{2}-\d{2} \|/,
};

/** Append-only logs: their historical entries keep the references they were written with. */
export const APPEND_ONLY_LOGS: readonly string[] = [
  'docs/plans/phase-1/log.md',
  'docs/plans/phase-1/audits/golden-gate-log.md',
  'docs/technical/test-incident-log.md',
];

/** Skills that exist only under `.claude/skills`. */
export const UNMIRRORED_SKILLS: readonly string[] = ['coderabbit-review'];

/** The living roadmap family, which never closes and so needs no "Durable homes" section. */
export const LIVING_PLAN_FAMILY: readonly string[] = [
  'docs/plans/phase-1/roadmap.md',
  'docs/plans/phase-1/protocol.md',
  'docs/plans/phase-1/gates.md',
  'docs/plans/phase-1/coverage.md',
  'docs/plans/phase-1/log.md',
];

/** Code files that cite a missing docs path on purpose, as `<file> -> <path>`. */
export const DEAD_CITATIONS: readonly string[] = [
  'lib/testing/evidence/build-identity.test.ts -> docs/note.md',
  'lib/testing/evidence/candidate-identity.test.ts -> docs/testing.md',
  'lib/testing/selection/coverage-map.test.ts -> docs/review.md',
];

/** Files that spell numbered-rule phrases as fixtures of the rule itself. */
export const NUMBERED_RULE_FIXTURES: readonly string[] = [
  'lib/docs/reference-rules.ts',
  'lib/docs/reference-rules.test.ts',
];

/** Sentences of twelve or more words that may stand in two living docs or skills. */
export const SHARED_SENTENCES: readonly string[] = [];

/** One setting of the policy as the decision table states it: its kind and its value. */
export type PolicyRow = { setting: string; value: string };

/** The rows of this file, in the shape of the decision table. */
export function policyRows(): PolicyRow[] {
  const rows: PolicyRow[] = [
    { setting: 'Word budget: living technical doc', value: String(WORD_BUDGETS.livingTechnicalDoc) },
    { setting: 'Word budget: AGENTS.md', value: String(WORD_BUDGETS.agentsFile) },
    { setting: 'Word budget: docs index', value: String(WORD_BUDGETS.docsIndex) },
    { setting: 'Word budget: skill file', value: String(WORD_BUDGETS.skillFile) },
  ];
  const listed: readonly (readonly [string, readonly string[]])[] = [
    ['Unbudgeted doc', UNBUDGETED_DOCS],
    ['Dated doc', DATED_DOCS],
    ['Dated lines', Object.keys(DATED_LINES)],
    ['Append-only log', APPEND_ONLY_LOGS],
    ['Unmirrored skill', UNMIRRORED_SKILLS],
    ['Living plan', LIVING_PLAN_FAMILY],
    ['Dead citation', DEAD_CITATIONS],
    ['Numbered-rule fixture', NUMBERED_RULE_FIXTURES],
    ['Shared sentence', SHARED_SENTENCES],
  ];
  for (const [setting, values] of listed) rows.push(...values.map((value) => ({ setting, value })));
  return rows;
}

const TABLE_HEADER = '| Setting | Value | Reason |';

/**
 * The rows of the last settings table in a decision record: a table under the
 * header `| Setting | Value | Reason |`, whose value cell may wrap its value in
 * backticks. Each later amendment restates the whole table, so the last one rules.
 */
export function readDecisionPolicy(markdown: string): PolicyRow[] | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.lastIndexOf(TABLE_HEADER);
  if (start === -1) return null;
  const rows: PolicyRow[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const [setting = '', value = ''] = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    rows.push({ setting: setting.replace(/`/g, ''), value: value.replace(/^`|`$/g, '') });
  }
  return rows;
}

/** The rows that only one side holds, as readable lines. */
export function findPolicyDifferences(code: readonly PolicyRow[], decision: readonly PolicyRow[]): string[] {
  const key = (row: PolicyRow): string => `${row.setting} = ${row.value}`;
  const decided = new Set(decision.map(key));
  const coded = new Set(code.map(key));
  return [
    ...code
      .filter((row) => !decided.has(key(row)))
      .map((row) => `lib/docs/doc-policy.ts has "${key(row)}", which the latest decision table does not`),
    ...decision
      .filter((row) => !coded.has(key(row)))
      .map((row) => `the latest decision table has "${key(row)}", which lib/docs/doc-policy.ts does not`),
  ];
}
