import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for freshness contract rule 5 (docs/technical/realtime-and-caching.md):
// a failed read keeps the last data and sets `isStale`, and the surface marks
// that data and makes its dependent actions inert (`StaleRegion`). A live view
// whose result never reads `isStale` shows data the app knows may be out of
// date as if it were current. Every `useLiveView(` call reads `isStale` of its
// view (`view.isStale`, a destructured `isStale`, or a wrapper hook that
// returns the view or its `isStale`), or its file is listed below with the
// reason the view has no dependent actions. The list only shrinks.

const NO_DEPENDENT_ACTIONS: Readonly<Record<string, string>> = {
  'components/clock-state-provider.tsx':
    'the clock owns its failure contract: a reported failure shows statusError and blocks taps, and every tap sends the expected session version, so the server refuses a transition from a stale state',
  'components/kalender/use-calendar-data.ts':
    'an invalidation bridge with no data for the parking contexts: a failed read reports through reportReadFailure into the calendar stale state, which makes the calendar body inert',
  'components/kalender/use-calendar-range-data.ts':
    'an invalidation bridge with no data: the range owner reports a failed window through its readiness state, and calendar-body.tsx makes the calendar inert while it is stale',
  'components/organization/pending-join-request.tsx':
    'a watcher that renders nothing: it only moves the requester on once the request is decided',
  'components/organization/organization-realtime-bridge.tsx':
    'an invalidation bridge with no data: it reloads the memberships, which own their failure state',
  'components/realtime/attention-count-provider.tsx':
    'sidebar badge counts that keep the last known value; every action behind a badge reads its own list',
  'hooks/use-active-jobs.ts':
    'an activity indicator on job rows; no action depends on it and the server checks every clock start',
};

/** Whether the value bound to `name` has its `isStale` read or is handed back whole from the function. */
function readsStaleOf(name: string, scope: ts.Node): boolean {
  let reads = false;
  function visit(node: ts.Node): void {
    if (reads) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name &&
      node.name.text === 'isStale'
    )
      reads = true;
    if (ts.isReturnStatement(node) && node.expression && ts.isIdentifier(node.expression))
      reads ||= node.expression.text === name;
    // A wrapper hook that returns `{ view, … }` hands the view to its caller.
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === name && returnedObject(node.parent))
      reads = true;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === name
    )
      reads ||= node.name.elements.some((element) => bindingName(element) === 'isStale');
    ts.forEachChild(node, visit);
  }
  visit(scope);
  return reads;
}

function returnedObject(node: ts.Node): boolean {
  return ts.isObjectLiteralExpression(node) && ts.isReturnStatement(node.parent);
}

function bindingName(element: ts.BindingElement): string | null {
  const key = element.propertyName ?? element.name;
  return ts.isIdentifier(key) ? key.text : null;
}

/** The function that contains the call, or the file when the call sits at the top level. */
function enclosingScope(node: ts.Node): ts.Node {
  let current = node.parent;
  while (!ts.isSourceFile(current) && !ts.isFunctionLike(current)) current = current.parent;
  return current;
}

/** Whether one `useLiveView(` call has its `isStale` read. */
function callReadsStale(call: ts.CallExpression): boolean {
  const parent = call.parent;
  if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) return true;
  if (!ts.isVariableDeclaration(parent)) return false;
  if (ts.isObjectBindingPattern(parent.name))
    return parent.name.elements.some((element) => bindingName(element) === 'isStale');
  return ts.isIdentifier(parent.name) && readsStaleOf(parent.name.text, enclosingScope(call));
}

function liveViewCalls(node: ts.Node, found: ts.CallExpression[] = []): ts.CallExpression[] {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useLiveView')
    found.push(node);
  ts.forEachChild(node, (child) => void liveViewCalls(child, found));
  return found;
}

function liveViewFiles(): Map<string, ts.CallExpression[]> {
  const files = new Map<string, ts.CallExpression[]>();
  for (const file of listProductSources(['app', 'components', 'hooks'])) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    if (!text.includes('useLiveView')) continue;
    const calls = liveViewCalls(parseProductSource(file, text));
    if (calls.length > 0) files.set(file, calls);
  }
  return files;
}

test('every live view marks its data when a read fails', () => {
  const findings = [...liveViewFiles()]
    .filter(([file]) => !(file in NO_DEPENDENT_ACTIONS))
    .flatMap(([file, calls]) =>
      calls
        .filter((call) => !callReadsStale(call))
        .map((call) => {
          const source = call.getSourceFile();
          return `${file}:${source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1}`;
        }),
    );
  expect(
    findings,
    'A live view that ignores isStale shows last-known data as current after a failed read. Wrap the dependent content in StaleRegion (components/shared/stale-region.tsx), or list the file in NO_DEPENDENT_ACTIONS with the reason no action depends on it.',
  ).toEqual([]);
});

test('every NO_DEPENDENT_ACTIONS entry still names a live view that ignores isStale', () => {
  const files = liveViewFiles();
  const stale = Object.keys(NO_DEPENDENT_ACTIONS).filter((file) => {
    const calls = files.get(file);
    return calls === undefined || calls.every(callReadsStale);
  });
  expect(stale, 'Remove the entry: the file reads isStale now or no longer calls useLiveView.').toEqual([]);
});
