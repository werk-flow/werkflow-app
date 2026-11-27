// Rule test: a live view that shows daily targets hears of every source of a
// target (werk-flow/werkflow-planning#589).
import { expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for virtue 2 (a saved result reaches every view and session). The
// approver's vacation queue listened to the requests alone, so a changed
// Wochenplan, closure day or exit date left its day counts stale. A view whose
// read returns targets, or day counts made of them, names the one list of
// their sources, `DAILY_TARGET_LIVE_TABLES` (lib/personnel/targets.ts), in its
// `tables`; the person's own signal reaches them through that list too.

/** Background reads whose result is a daily target or a sum of them. */
const TARGET_READ_KINDS = [
  'weekly-targets',
  'own-vacation-overview',
  'pending-vacation-for-approver',
  'decidable-approved-vacation',
];

const TARGET_TABLES = 'DAILY_TARGET_LIVE_TABLES';

function property(literal: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const member of literal.properties) {
    if (ts.isPropertyAssignment(member) && ts.isIdentifier(member.name) && member.name.text === name)
      return member.initializer;
  }
  return undefined;
}

/** Same-file functions by name: declarations and `const` arrow or function expressions. */
function localFunctions(source: ts.SourceFile): Map<string, ts.Node> {
  const functions = new Map<string, ts.Node>();
  ts.forEachChild(source, function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      functions.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  });
  return functions;
}

/** The read's text, with each same-file function it calls followed one step. */
function readText(read: ts.Expression, source: ts.SourceFile, functions: Map<string, ts.Node>): string {
  const parts = [read.getText(source)];
  ts.forEachChild(read, function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const called = functions.get(node.expression.text);
      if (called) parts.push(called.getText(source));
    }
    ts.forEachChild(node, visit);
  });
  return parts.join('\n');
}

type TargetView = { line: number; listensToTargets: boolean };

/** Each `useLiveView` call of a file whose read returns targets. */
function targetViews(file: string, text?: string): TargetView[] {
  const source = parseProductSource(file, text);
  const functions = localFunctions(source);
  const views: TargetView[] = [];
  ts.forEachChild(source, function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useLiveView' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const options = node.arguments[0];
      const read = property(options, 'read');
      const reads = read ? readText(read, source, functions) : '';
      if (TARGET_READ_KINDS.some((kind) => reads.includes(`'${kind}'`))) {
        const tables = property(options, 'tables');
        views.push({
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          listensToTargets: tables !== undefined && tables.getText(source).includes(TARGET_TABLES),
        });
      }
    }
    ts.forEachChild(node, visit);
  });
  return views;
}

function scan(): Map<string, TargetView[]> {
  const found = new Map<string, TargetView[]>();
  for (const file of listProductSources(['app', 'components', 'hooks'])) {
    const views = targetViews(file);
    if (views.length > 0) found.set(file, views);
  }
  return found;
}

test('every live view that shows targets listens to every source of a target', () => {
  const missing = [...scan()].flatMap(([file, views]) =>
    views
      .filter((view) => !view.listensToTargets)
      .map((view) => `${file}:${view.line} reads targets without ${TARGET_TABLES} in its tables`),
  );
  expect(missing).toEqual([]);
});

test('the scan finds the week and both vacation views', () => {
  expect([...scan().keys()].sort()).toEqual([
    'components/zeiterfassung/vacation-approvals.tsx',
    'components/zeiterfassung/vacation-section.tsx',
    'hooks/use-weekly-time-data.ts',
  ]);
});

test('the scan follows a same-file read function and flags a partial table list', () => {
  const planted = targetViews(
    'components/planted.tsx',
    `async function readQueue(signal: AbortSignal) {
      return readInBackground('pending-vacation-for-approver', {}, signal);
    }
    function Queue() {
      const view = useLiveView({ tables: ['vacation_requests'], read: ({ signal }) => readQueue(signal) });
      const week = useLiveView({ tables: [...DAILY_TARGET_LIVE_TABLES], read: () => readInBackground('weekly-targets', {}) });
      const other = useLiveView({ tables: ['jobs'], read: () => readInBackground('parked-jobs', {}) });
      return null;
    }`,
  );
  expect(planted.map((view) => view.listensToTargets)).toEqual([false, true]);
});
