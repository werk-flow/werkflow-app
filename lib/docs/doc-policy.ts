// The settings of docs:check: word budgets and exemptions. This file is their one home. A budget
// or an exemption changes only by the owner's decision, named in the commit that changes it.

/** Word budgets, counted like `wc -w`. */
const WORD_BUDGETS = {
  technicalDoc: 4000,
  agentsFile: 2800,
  docsIndex: 3600,
  skillFile: 4000,
} as const;

/** The word budget of a file by its repository path, or null when none applies. */
export function wordBudgetOf(path: string): number | null {
  if (path === 'AGENTS.md') return WORD_BUDGETS.agentsFile;
  if (path === 'docs/README.md') return WORD_BUDGETS.docsIndex;
  // The .agents mirror equals the .claude tree byte for byte, so the .claude copy stands for both.
  if (/^\.claude\/skills\/.+\.md$/.test(path)) return WORD_BUDGETS.skillFile;
  if (path.startsWith('docs/technical/')) return WORD_BUDGETS.technicalDoc;
  return null;
}

/** Skills that exist only under `.claude/skills`. */
export const UNMIRRORED_SKILLS: readonly string[] = ['coderabbit-review'];

/** Code files that cite a missing docs path on purpose, as `<file> -> <path>`. */
export const DEAD_CITATIONS: readonly string[] = [
  'lib/testing/evidence/build-identity.test.ts -> docs/note.md',
  'lib/testing/evidence/candidate-identity.test.ts -> docs/testing.md',
  'lib/testing/selection/coverage-map.test.ts -> docs/review.md',
];
