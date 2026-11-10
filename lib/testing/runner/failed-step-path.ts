/** What a Playwright reporter's `TestStep` tells about where a test broke. */
type ReportedStep = {
  title: string;
  category: string;
  error?: unknown;
  steps: readonly ReportedStep[];
};

/** Test steps, actions and assertions; hooks and fixtures never name where a test broke. */
const STEP_CATEGORIES: ReadonlySet<string> = new Set(['test.step', 'pw:api', 'expect']);

/**
 * The titles from a test's outermost failed step down to the innermost one. At each level the last
 * failed step counts: an earlier one failed inside a retry or a caught assertion, and the test went on.
 */
export function failedStepPath(steps: readonly ReportedStep[]): string[] {
  const failed = steps.findLast((step) => step.error !== undefined && STEP_CATEGORIES.has(step.category));
  return failed ? [failed.title, ...failedStepPath(failed.steps)] : [];
}
