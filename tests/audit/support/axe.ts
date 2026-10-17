import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// The rendered accessibility pass (werkflow-design, "Checklist"): axe-core's
// WCAG 2.1 A and AA rules on every inventoried page, tab and dialog, in both
// themes, and the landmark and heading rules on every whole page. The field
// worker's pages add WCAG 2.2's target-size rule (24 px).
//
// A rule may be switched off only here, only for a named third-party surface,
// with the reason written down. No such surface exists today, so the list is
// empty. `lib/testing/spec-support/axe-exceptions.test.ts` refuses
// `disableRules(` and `.exclude(` anywhere else under tests/.

type AxeException = {
  /** The axe rule id. */
  rule: string;
  /** The start of the axe target of the third-party surface the rule cannot judge. */
  target: string;
  /** The library that renders the surface. */
  surface: string;
  reason: string;
};

const AXE_EXCEPTIONS: readonly AxeException[] = [];

const WCAG_21 = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/**
 * Axe's best-practice rules for the landmarks and headings of a whole page,
 * on top of WCAG: one main landmark at the top level, no duplicate or nested
 * landmarks, a level-one heading, headings in order and none empty, no empty
 * table header. Two nested main landmarks and sign-in screens without a
 * heading passed the WCAG tags alone (UI audit of 2026-10-15). They judge the
 * whole page, so a pass limited to a dialog leaves them out.
 */
const PAGE_STRUCTURE_RULES = [
  'landmark-banner-is-top-level',
  'landmark-complementary-is-top-level',
  'landmark-contentinfo-is-top-level',
  'landmark-main-is-top-level',
  'landmark-no-duplicate-banner',
  'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-main',
  'landmark-one-main',
  'landmark-unique',
  'page-has-heading-one',
  'heading-order',
  'empty-heading',
  'empty-table-header',
] as const;

export type AxeScope = {
  /** Limit the pass to one layer, such as an open dialog. */
  include?: string;
  /** The field worker's pages also check WCAG 2.2 target sizes. */
  fieldWorker?: boolean;
};

/** Runs axe on the page as it is and fails with each violation's rule, impact, targets and summary. */
export async function expectNoAxeViolations(page: Page, label: string, scope: AxeScope = {}): Promise<void> {
  const tags = scope.fieldWorker ? [...WCAG_21, 'wcag22aa'] : [...WCAG_21];
  let builder = new AxeBuilder({ page }).options({
    runOnly: { type: 'tag', values: tags },
    // A rule enabled by name runs on top of the tags (axe-core `rules` option).
    ...(scope.include
      ? {}
      : { rules: Object.fromEntries(PAGE_STRUCTURE_RULES.map((rule) => [rule, { enabled: true }])) }),
  });
  if (scope.include) builder = builder.include(scope.include);
  const results = await builder.analyze();
  // An exception excuses one rule on one surface, never the rule elsewhere or other rules there.
  const excused = (rule: string, target: string): boolean =>
    AXE_EXCEPTIONS.some((exception) => exception.rule === rule && target.startsWith(exception.target));
  const violations = results.violations
    .map((violation) => ({
      violation,
      nodes: violation.nodes.filter((node) => !excused(violation.id, node.target.join(' '))),
    }))
    .filter(({ nodes }) => nodes.length > 0)
    .map(({ violation, nodes }) => ({
      rule: violation.id,
      impact: violation.impact ?? 'unknown',
      count: nodes.length,
      targets: nodes.slice(0, 3).map((node) => node.target.join(' ')),
      summary: nodes[0]?.failureSummary?.replace(/\s+/g, ' ').slice(0, 240) ?? violation.help,
    }));
  expect(violations, `${label}: axe WCAG 2.1 A/AA and page-structure violations`).toEqual([]);
}
