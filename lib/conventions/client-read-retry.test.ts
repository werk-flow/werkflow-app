// Rule test: a failed client read reaches the screen only together with its retry.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for the client reads (AGENTS.md "1. UI and UX": a region that fails
// shows a retry). The Tier 1 owner is hooks/use-client-read.ts: its
// `ReadFailure` carries the message and the retry together, and the two
// rendering homes (`SectionError failure`, the select family's `loadFailure`)
// take only that object. This scan closes the ways around it in client code
// under app/, components/ and hooks/:
//   (a) a hand-written `useState` that records a failed read, by its name;
//   (b) an `ErrorText` that renders a read failure, which has no retry;
//   (c) a stale live view rendered through `ErrorText`, or rendered by a file
//       that offers no `StaleRegion`, `SectionError` or `RefreshButton`.

/**
 * Names that say a read failed: `loadError`, `jobsLoadError`, `optionsError`,
 * `evidenceLoadFailed`. The verb starts the name or a camel-case word, so
 * `uploadError` and `downloadError` (an upload, a prepared download) are
 * actions, not reads.
 */
const READ_FAILURE_NAME =
  /(?:^(?:load|read|fetch|options?)|[a-z](?:Load|Read|Fetch|Options?))(?:Error|Failed|Failure)$/;

/**
 * Read-failure states whose names do not say "load", found by a manual review.
 * `documentError` and `timeSourceError` (use-work-artifact-links.ts) were
 * reviewed too: they hold the „Bitte wähle …“ validation of a link form.
 */
const HAND_LISTED_NAMES = new Set(['failed', 'employeesFailed']);

/** The one module that may hold a read's failure state. */
const OWNER = 'hooks/use-client-read.ts';

const STALE_HOMES = new Set(['StaleRegion', 'SectionError', 'RefreshButton']);

function namesReadFailure(name: string): boolean {
  return READ_FAILURE_NAME.test(name) || HAND_LISTED_NAMES.has(name);
}

function isUseStateCall(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'useState';
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'useState';
}

function tagName(node: ts.Node, source: ts.SourceFile): string | undefined {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(source);
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(source);
  return undefined;
}

/** Does the subtree hold a node for which `found` holds? */
function contains(node: ts.Node, found: (child: ts.Node) => boolean): boolean {
  if (found(node)) return true;
  return ts.forEachChild(node, (child) => (contains(child, found) ? true : undefined)) ?? false;
}

/** An identifier or property that names a read failure, or a `….failure.message` read. */
function rendersReadFailure(node: ts.Node, source: ts.SourceFile): boolean {
  return contains(node, (child) => {
    if (ts.isIdentifier(child)) return namesReadFailure(child.text);
    return (
      ts.isPropertyAccessExpression(child) &&
      child.name.text === 'message' &&
      /[Ff]ailure\??$/.test(child.expression.getText(source))
    );
  });
}

/**
 * Local `const` initializers, so a condition or branch held in a const is
 * followed one step. A choice (`stale ? a : b`) is a value, not a condition.
 */
function constInitializers(source: ts.SourceFile): Map<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>();
  ts.forEachChild(source, function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !ts.isConditionalExpression(node.initializer)
    )
      initializers.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  });
  return initializers;
}

function readsStale(node: ts.Node, initializers: Map<string, ts.Expression>, depth = 0): boolean {
  return contains(node, (child) => {
    if (!ts.isIdentifier(child)) return false;
    if (child.text === 'isStale') return true;
    const initializer = initializers.get(child.text);
    return depth === 0 && initializer !== undefined && readsStale(initializer, initializers, 1);
  });
}

/** The rendered branches of `{stale && …}` and `{stale ? … : …}` in JSX. */
function staleBranches(source: ts.SourceFile, initializers: Map<string, ts.Expression>): ts.Node[] {
  const branches: ts.Node[] = [];
  ts.forEachChild(source, function visit(node) {
    if (ts.isJsxExpression(node) && node.expression) {
      const expression = node.expression;
      if (
        ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        readsStale(expression.left, initializers)
      )
        branches.push(expression.right);
      if (ts.isConditionalExpression(expression) && readsStale(expression.condition, initializers))
        branches.push(expression.whenTrue);
    }
    ts.forEachChild(node, visit);
  });
  return branches;
}

/** Findings of one file, each prefixed with its rule letter. */
export function clientReadFindings(file: string, text: string): string[] {
  const source = parseProductSource(file, text);
  const findings: string[] = [];
  const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const initializers = constInitializers(source);

  ts.forEachChild(source, function visit(node) {
    if (
      file !== OWNER &&
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      isUseStateCall(node.initializer)
    ) {
      const first = node.name.elements[0];
      if (
        first &&
        ts.isBindingElement(first) &&
        ts.isIdentifier(first.name) &&
        namesReadFailure(first.name.text)
      )
        findings.push(`(a) ${file}:${line(node)} useState ${first.name.text}`);
    }
    if (tagName(node, source) === 'ErrorText' && ts.isJsxElement(node)) {
      const failing = node.children.filter(
        (child) => ts.isJsxExpression(child) && rendersReadFailure(child, source),
      );
      if (failing.length > 0) findings.push(`(b) ${file}:${line(node)} ErrorText renders a read failure`);
    }
    ts.forEachChild(node, visit);
  });

  const branches = staleBranches(source, initializers);
  for (const branch of branches) {
    const target = ts.isIdentifier(branch) ? (initializers.get(branch.text) ?? branch) : branch;
    if (contains(target, (child) => tagName(child, source) === 'ErrorText'))
      findings.push(`(c) ${file}:${line(branch)} stale view rendered through ErrorText`);
  }
  const offersRetry = contains(source, (child) => STALE_HOMES.has(tagName(child, source) ?? ''));
  if (branches.length > 0 && !offersRetry)
    findings.push(`(c) ${file} renders a stale view without StaleRegion, SectionError or RefreshButton`);
  return findings;
}

test('client code shows every failed read with its retry', () => {
  const findings = listProductSources(['app', 'components', 'hooks']).flatMap((file) =>
    clientReadFindings(file, readFileSync(resolve(repositoryRoot, file), 'utf8')),
  );
  expect(
    findings,
    'Read through useClientRead (hooks/use-client-read.ts) and render its failure with <SectionError failure={…} /> or a select’s loadFailure; a stale live view renders through StaleRegion, SectionError or RefreshButton.',
  ).toEqual([]);
});

test('the scan flags a hand-written read failure and accepts the hook', () => {
  const planted = clientReadFindings(
    'components/planted.tsx',
    `function Options() {
      const [loadError, setLoadError] = useState<string | null>(null);
      return <ErrorText>{loadError}</ErrorText>;
    }`,
  );
  expect(planted.map((finding) => finding.slice(0, 3))).toEqual(['(a)', '(b)']);
  const viaHook = clientReadFindings(
    'components/planted.tsx',
    `function Options() {
      const read = useClientRead({ read: load, deps: [], failureMessage: 'Die Liste konnte nicht geladen werden.' });
      const [uploadError, setUploadError] = useState<string | null>(null);
      return <>{read.failure && <SectionError failure={read.failure} />}<ErrorText>{uploadError}</ErrorText></>;
    }`,
  );
  expect(viaHook).toEqual([]);
  expect(
    clientReadFindings('components/planted.tsx', `const x = <ErrorText>{read.failure?.message}</ErrorText>;`),
  ).toHaveLength(1);
});

test('the scan flags a stale view rendered through ErrorText and accepts the retry homes', () => {
  const planted = clientReadFindings(
    'components/planted.tsx',
    `function Header() {
      const view = useLiveView({ tables: [], read });
      return <>{view.isStale ? <ErrorText>Nicht aktuell.</ErrorText> : null}</>;
    }`,
  );
  expect(planted.map((finding) => finding.slice(0, 3))).toEqual(['(c)', '(c)']);
  const followed = clientReadFindings(
    'components/planted.tsx',
    `function Header() {
      const outdated = view.error || view.isStale;
      return <>{outdated && <p>Nicht aktuell.</p>}</>;
    }`,
  );
  expect(followed).toHaveLength(1);
  const accepted = clientReadFindings(
    'components/planted.tsx',
    `function Header() {
      const notice = <SectionError onRetry={view.refresh}>Nicht aktuell.</SectionError>;
      return <>{view.isStale ? notice : null}</>;
    }`,
  );
  expect(accepted).toEqual([]);
});
