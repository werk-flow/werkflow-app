import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// The rendered accessibility pass (werkflow-design, "Checklist"): axe-core's
// WCAG 2.1 A and AA rules on every inventoried page, tab and dialog, in both
// themes. The field worker's pages add WCAG 2.2's target-size rule.
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

export type AxeScope = {
  /** Limit the pass to one layer, such as an open dialog. */
  include?: string;
  /** The field worker's pages also check WCAG 2.2 target sizes. */
  fieldWorker?: boolean;
};

/** Runs axe on the page as it is and fails with each violation's rule, impact, targets and summary. */
export async function expectNoAxeViolations(page: Page, label: string, scope: AxeScope = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(
    scope.fieldWorker ? [...WCAG_21, 'wcag22aa'] : [...WCAG_21],
  );
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
  expect(violations, `${label}: axe WCAG 2.1 A/AA violations`).toEqual([]);
}
