import { expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "a failed region shows a retry, and a live page keeps listening"
// (AGENTS.md "1. UI and UX" and "2. Performance and immediate feedback";
// docs/technical/realtime-and-caching.md). A server page that renders its
// Realtime listener only beside a successful read drops the listener when a
// read fails: the region shows its retry, but no later change reads it again.
// „Meine Meldungen“ and support's pages did that (PR #389). The listener goes
// where the read cannot remove it, beside the Suspense boundary or before the
// branch, as `LiveRouteRefresh` sits in the settings pages.
//
// A listener is an exported component that calls `useRealtimeRouterRefresh`
// and renders nothing. The scan reports a function under `app/` or
// `components/` that renders a listener in one branch and a `RegionLoadError`
// without it in another: two return statements, or the two arms of one
// conditional expression.

type Finding = { key: string; line: number };

function callsRouterRefresh(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === 'useRealtimeRouterRefresh'
    )
      found = true;
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function returnsOnlyNull(body: ts.Block): boolean {
  const returns: ts.ReturnStatement[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isFunctionLike(child)) return;
    if (ts.isReturnStatement(child)) returns.push(child);
    ts.forEachChild(child, visit);
  };
  body.statements.forEach(visit);
  return (
    returns.length > 0 &&
    returns.every((statement) => statement.expression?.kind === ts.SyntaxKind.NullKeyword)
  );
}

/** The names of the listener components: exported, calling the route refresh hook, rendering nothing. */
function listenerNames(sources: ReadonlyMap<string, ts.SourceFile>): Set<string> {
  const names = new Set<string>();
  for (const source of sources.values()) {
    for (const statement of source.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && callsRouterRefresh(statement.body) && returnsOnlyNull(statement.body))
        names.add(statement.name.text);
    }
  }
  return names;
}

function rendersElement(node: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found || (child !== node && ts.isFunctionLike(child))) return;
    if (
      (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) &&
      ts.isIdentifier(child.tagName) &&
      names.has(child.tagName.text)
    )
      found = true;
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

const REGION_ERROR = new Set(['RegionLoadError']);

/** Branches that each render something, in one function: its returns, and each conditional's two arms. */
function branchPairs(body: ts.Node): Array<readonly [ts.Node, ts.Node]> {
  const returns: ts.Node[] = [];
  const pairs: Array<readonly [ts.Node, ts.Node]> = [];
  const visit = (child: ts.Node): void => {
    if (ts.isFunctionLike(child)) return;
    if (ts.isReturnStatement(child) && child.expression) returns.push(child.expression);
    if (ts.isConditionalExpression(child)) pairs.push([child.whenTrue, child.whenFalse]);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(body, visit);
  for (const [index, first] of returns.entries())
    for (const second of returns.slice(index + 1)) pairs.push([first, second]);
  return pairs;
}

function findingsOf(source: ts.SourceFile, file: string, listeners: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      for (const [first, second] of branchPairs(node.body)) {
        for (const [listening, failing] of [
          [first, second],
          [second, first],
        ] as const) {
          if (
            rendersElement(listening, listeners) &&
            rendersElement(failing, REGION_ERROR) &&
            !rendersElement(failing, listeners)
          ) {
            const line = source.getLineAndCharacterOfPosition(failing.getStart(source)).line + 1;
            findings.push({ key: `${file}:${line}`, line });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

const sources = new Map(
  listProductSources(['app', 'components'])
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => [file, parseProductSource(file)] as const),
);
const listeners = listenerNames(sources);

test('the listener components are found', () => {
  expect([...listeners]).toEqual(expect.arrayContaining(['LiveRouteRefresh', 'ProblemReportSignalsLive']));
});

test('no page drops its live listener in the branch that shows a failed read', () => {
  const findings = [...sources].flatMap(([file, source]) => findingsOf(source, file, listeners));
  expect(
    findings.map((finding) => finding.key),
    'Render the listener outside the read, beside its Suspense boundary or before the branch, so a later change reads the failed region again.',
  ).toEqual([]);
});
