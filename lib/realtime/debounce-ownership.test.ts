import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from '@/lib/conventions/product-sources';
import { REALTIME_DEBOUNCE_MS, REALTIME_MAX_DEFER_MS } from './events';

// Tier 2 for "Shorten REALTIME_DEBOUNCE_MS or give a surface its own debounce"
// (docs/technical/realtime-and-caching.md, Never). A shorter window raced the
// server cache invalidation; a surface's own debounce races the shared one and
// has no maximum deferral, so a stream of events postpones its read until the
// stream pauses. Product code fails when
//   1. createTrailingScheduler gets another delay than REALTIME_DEBOUNCE_MS or
//      another maximum than REALTIME_MAX_DEFER_MS,
//   2. REALTIME_DEBOUNCE_MS or REALTIME_MAX_DEFER_MS is used anywhere else
//      (a hand-written setTimeout debounce),
//   3. a setTimeout callback refreshes or refetches (`refresh(`, `refetch(`,
//      `invalidate(`), unless the site is a reviewed entry in
//      DELAYED_REFRESH_SITES whose reason says why it is no debounce. An entry
//      that matches no call fails too.

const CONSTANTS_HOME = 'lib/realtime/events.ts';
const SCHEDULER_HOME = 'lib/realtime/scheduler.ts';
const TIMED_REFRESH = 'a timed refresh outside the shared scheduler';

/** file -> why its timed refresh is not a Realtime debounce. */
const DELAYED_REFRESH_SITES: Readonly<Record<string, string>> = {
  'components/mitarbeiter/personnel-invite-dialog.tsx':
    'the dialog shows its success state for 1.5 s, then closes and refreshes the route once; no event triggers it',
};

const REFRESH_CALL = /\b(?:refresh|refetch|invalidate)\s*\(/;

type Finding = { file: string; line: number; problem: string };

function calleeName(call: ts.CallExpression): string | null {
  const { expression } = call;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function propertyValue(argument: ts.Expression | undefined, name: string): string | null {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
  for (const property of argument.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name)
      return property.initializer.getText();
  }
  return null;
}

// The constant as the shared scheduler's own option: `delayMs: REALTIME_DEBOUNCE_MS`.
function isSchedulerOption(identifier: ts.Identifier): boolean {
  const assignment = identifier.parent;
  if (!ts.isPropertyAssignment(assignment) || assignment.initializer !== identifier) return false;
  const call = assignment.parent.parent;
  return ts.isCallExpression(call) && calleeName(call) === 'createTrailingScheduler';
}

function callProblems(call: ts.CallExpression, source: ts.SourceFile): string[] {
  const name = calleeName(call);
  const [first] = call.arguments;
  const problems: string[] = [];
  if (name === 'createTrailingScheduler') {
    if (propertyValue(first, 'delayMs') !== 'REALTIME_DEBOUNCE_MS')
      problems.push('a trailing scheduler with its own delay');
    if (propertyValue(first, 'maxWaitMs') !== 'REALTIME_MAX_DEFER_MS')
      problems.push('a trailing scheduler with its own maximum deferral');
  }
  if (name === 'setTimeout' && first && REFRESH_CALL.test(first.getText(source)))
    problems.push(TIMED_REFRESH);
  return problems;
}

/** The debounce problems of one product source. */
function findDebounceProblems(file: string, text: string): Finding[] {
  if (file === CONSTANTS_HOME || file === SCHEDULER_HOME) return [];
  const source = parseProductSource(file, text);
  const findings: Finding[] = [];
  const report = (node: ts.Node, problem: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    findings.push({ file, line, problem });
  };
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) for (const problem of callProblems(node, source)) report(node, problem);
    if (
      ts.isIdentifier(node) &&
      (node.text === 'REALTIME_DEBOUNCE_MS' || node.text === 'REALTIME_MAX_DEFER_MS') &&
      !ts.isImportSpecifier(node.parent) &&
      !isSchedulerOption(node)
    )
      report(node, `${node.text} outside the shared scheduler`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return findings;
}

describe('realtime debounce ownership', () => {
  test('the shared debounce and its maximum deferral keep their measured values', () => {
    // 150 ms: shorter windows raced the server cache invalidation; a wider
    // window and a longer cap are rejected hypotheses (realtime-and-caching, Never).
    expect(REALTIME_DEBOUNCE_MS).toBe(150);
    expect(REALTIME_MAX_DEFER_MS).toBe(1_000);
  });

  test('product code debounces Realtime and refreshes only through the shared scheduler', () => {
    const findings = listProductSources().flatMap((file) =>
      findDebounceProblems(file, parseProductSource(file).getFullText()),
    );
    const unlisted = findings.filter(
      ({ file, problem }) => !(problem === TIMED_REFRESH && file in DELAYED_REFRESH_SITES),
    );
    expect(unlisted).toEqual([]);
    const timedRefreshFiles = new Set(
      findings.filter(({ problem }) => problem === TIMED_REFRESH).map(({ file }) => file),
    );
    expect(Object.keys(DELAYED_REFRESH_SITES).filter((file) => !timedRefreshFiles.has(file))).toEqual([]);
  });

  test('planted debounces fail and the shared scheduler passes', () => {
    const problems = (text: string): string[] =>
      findDebounceProblems('components/probe.tsx', text).map(({ problem }) => problem);
    expect(
      problems(
        "import { REALTIME_DEBOUNCE_MS } from '@/lib/realtime/events';\nconst timer = setTimeout(run, REALTIME_DEBOUNCE_MS);",
      ),
    ).toEqual(['REALTIME_DEBOUNCE_MS outside the shared scheduler']);
    expect(problems('const timer = window.setTimeout(() => view.refresh(), 50);')).toEqual([TIMED_REFRESH]);
    expect(problems('setTimeout(() => { router.refresh(); }, 200);')).toEqual([TIMED_REFRESH]);
    expect(
      problems(
        'createTrailingScheduler({ delayMs: 50, maxWaitMs: REALTIME_MAX_DEFER_MS, run });\ncreateTrailingScheduler({ delayMs: REALTIME_DEBOUNCE_MS, maxWaitMs: 5_000, run });',
      ),
    ).toEqual([
      'a trailing scheduler with its own delay',
      'a trailing scheduler with its own maximum deferral',
    ]);
    expect(
      problems(
        "import { REALTIME_DEBOUNCE_MS, REALTIME_MAX_DEFER_MS } from '@/lib/realtime/events';\ncreateTrailingScheduler({ delayMs: REALTIME_DEBOUNCE_MS, maxWaitMs: REALTIME_MAX_DEFER_MS, run });\nsetTimeout(() => setCopied(false), 2000);",
      ),
    ).toEqual([]);
  });
});
