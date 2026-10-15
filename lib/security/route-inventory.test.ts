import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

// Tier 2 inventory for route handlers (SI-001, SI-007, SI-013). A route handler
// gets no framework authentication or CSRF check, so every one that exists
// must be listed here with the mechanism that authorizes it, and the handler
// module must call that mechanism: a call expression in the parsed module,
// never a mention in a comment, a string or an import. A second test fails
// when a response body or a redirect URL carries the `message` or `details`
// of an error, directly or through a variable derived from one.

const repositoryRoot = resolve(import.meta.dir, '../..');

const reviewedHandlers: Record<string, { authorization: string; mustCall: readonly string[] }> = {
  'app/api/customer-page/route.ts': {
    authorization:
      'verified cookie identity, current manager role and active organization equality before the bounded shared customer reader; validated query and private no-store responses',
    mustCall: ['authenticateAndAuthorize', 'withReadRequest', 'customerPageInputSchema', 'readCustomerPage'],
  },
  'app/api/time-tracking-state/route.ts': {
    authorization:
      'verified cookie identity and matching active organization before delegating to existing self-clock and membership-checked active-job readers; validated kind/UUID, private no-store responses',
    mustCall: [
      'authenticateAndAuthorize',
      'getCurrentClockState',
      'getActiveJobIdsForOrg',
      'withReadRequest',
    ],
  },
  'app/api/calendar-window/route.ts': {
    authorization:
      'delegates to getCalendarWindow: verified cookie identity, active organization equality, bounded paired ranges, and constituent role permissions; every response is private and no-store',
    mustCall: ['getCalendarWindow'],
  },
  'app/api/calendar-board/route.ts': {
    authorization:
      'delegates to getCalendarBoardContext: verified cookie identity, active organization equality, a bounded date window, manager-only rows with the employee reduced to their own record; every response is private and no-store',
    mustCall: ['getCalendarBoardContext'],
  },
  'app/api/attention-counts/route.ts': {
    authorization:
      'delegates to getAttentionCounts, which authenticates the cookie session, resolves the active organization, and checks membership',
    mustCall: ['getAttentionCounts'],
  },
  'app/api/redeem-invite/route.ts': {
    authorization:
      'same-origin JSON guard before any cookie is written; getUser() on the caller session, where a check that cannot complete answers 503; the redemption limit; the RPC binds the invite to that user',
    mustCall: [
      'verifySameOriginJsonRequest',
      'isUuid',
      'createSupabaseServerClient',
      'isRejectedIdentity',
      'consumeRateLimit',
    ],
  },
  'app/api/csp-report/route.ts': {
    authorization:
      'unauthenticated by design: receives the browser reports of the enforced script policy, reads and writes nothing, bounds the body, and logs a redacted summary without script samples or query strings',
    mustCall: ['summarizeCspReport'],
  },
  'app/api/background-read/route.ts': {
    authorization:
      'closed reader registry with per-kind validated input; verified cookie identity and, for inputs that name an organization, active-organization equality before delegating to readers that keep their own membership and subject checks; private no-store responses at background priority',
    mustCall: ['authenticateAndAuthorize', 'withReadRequest', 'isBackgroundReadKind'],
  },
  'app/auth/callback/route.ts': {
    authorization:
      'GET: provider code/token exchange with a same-origin return path; an invite redeems only after a PKCE code exchange, a bare invite link redirects to the login page; an Auth failure that is not a refusal answers a private 503. POST: same-origin JSON guard before setSession',
    mustCall: [
      'resolveSafeReturnPath',
      'verifySameOriginJsonRequest',
      'isUuid',
      'isRejectedSignInLink',
      'consumeRateLimit',
    ],
  },
  'app/auth/flash/route.ts': {
    authorization: 'writes only an allowlisted flash key into a short-lived cookie',
    mustCall: ['isAuthFlashKey'],
  },
};

const ROUTE_FILE = /^route\.(ts|tsx|js|jsx|mjs)$/;

function listRouteHandlers(root: string): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (ROUTE_FILE.test(entry.name)) found.push(path);
    }
  }
  visit('app');
  return found.sort();
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = /\.(tsx|jsx)$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.m?js$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function forEachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => forEachNode(child, visit));
}

// The identifiers a callee is built from: `a.b.c(...)` gives a, b and c; `a[k](...)` gives a.
function calleeNames(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    return [...calleeNames(expression.expression), expression.name.text];
  }
  if (
    ts.isElementAccessExpression(expression) ||
    ts.isCallExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return calleeNames(expression.expression);
  }
  return [];
}

/** The required authorization calls that the module does not make. */
function missingCalls(file: string, text: string, required: readonly string[]): string[] {
  const called = new Set<string>();
  forEachNode(parse(file, text), (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      for (const name of calleeNames(node.expression)) called.add(name);
    }
  });
  return required.filter((name) => !called.has(name));
}

const ERROR_FIELDS = new Set(['message', 'details']);
// A boolean test on a message maps it to a fixed code; the text itself stays inside.
const BOOLEAN_TESTS = new Set(['includes', 'startsWith', 'endsWith']);

function errorFieldAccess(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node) && ERROR_FIELDS.has(node.name.text)) {
    const parent = node.parent;
    const isTested =
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === node &&
      BOOLEAN_TESTS.has(parent.name.text) &&
      ts.isCallExpression(parent.parent);
    return isTested ? null : node.name.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression) &&
    ERROR_FIELDS.has(node.argumentExpression.text)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function isNameOnly(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isBindingElement(parent) && (parent.name === identifier || parent.propertyName === identifier))
  );
}

function isDetailsProperty(node: ts.Node): boolean {
  return (
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'details'
  );
}

/** The first error field or derived variable that the subtree reads, or null. */
function leakIn(node: ts.Node, tainted: ReadonlySet<string>): string | null {
  let found: string | null = null;
  forEachNode(node, (child) => {
    if (found !== null) return;
    const field = errorFieldAccess(child);
    if (field !== null) found = `.${field}`;
    else if (isDetailsProperty(child)) found = 'details:';
    else if (ts.isIdentifier(child) && tainted.has(child.text) && !isNameOnly(child)) found = child.text;
  });
  return found;
}

/** Variables whose value derives from an error's message or details, to a fixed point. */
function taintedVariables(source: ts.SourceFile): Set<string> {
  const tainted = new Set<string>();
  let size = -1;
  while (size !== tainted.size) {
    size = tainted.size;
    forEachNode(source, (node) => {
      if (!ts.isVariableDeclaration(node)) return;
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name;
          if (ts.isIdentifier(property) && ERROR_FIELDS.has(property.text) && ts.isIdentifier(element.name)) {
            tainted.add(element.name.text);
          }
        }
        return;
      }
      if (ts.isIdentifier(node.name) && node.initializer !== undefined && leakIn(node.initializer, tainted)) {
        tainted.add(node.name.text);
      }
    });
  }
  return tainted;
}

const RESPONSE_FACTORIES = new Set(['Response', 'NextResponse']);
const RESPONSE_METHODS = new Set(['json', 'redirect', 'rewrite']);
const URL_WRITERS = new Set(['set', 'append']);

// A response body or a redirect URL: Response/NextResponse.json|redirect|rewrite,
// new Response/NextResponse, redirect() from next/navigation, and searchParams.set/append.
function isResponseSink(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
  if (ts.isNewExpression(node)) {
    return ts.isIdentifier(node.expression) && RESPONSE_FACTORIES.has(node.expression.text);
  }
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'redirect' || callee.text === 'permanentRedirect';
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (ts.isIdentifier(callee.expression) && RESPONSE_FACTORIES.has(callee.expression.text)) {
    return RESPONSE_METHODS.has(callee.name.text);
  }
  return (
    URL_WRITERS.has(callee.name.text) &&
    ts.isPropertyAccessExpression(callee.expression) &&
    callee.expression.name.text === 'searchParams'
  );
}

/** One finding per response sink that carries an error's message or details. */
function errorLeaks(file: string, text: string): string[] {
  const source = parse(file, text);
  const tainted = taintedVariables(source);
  const findings: string[] = [];
  forEachNode(source, (node) => {
    if (!isResponseSink(node)) return;
    const leak = (node.arguments ?? []).map((argument) => leakIn(argument, tainted)).find((found) => found);
    if (!leak) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push(`${file}:${line + 1} returns ${leak}`);
  });
  return findings;
}

test('every route handler is reviewed and still calls its authorization mechanism', () => {
  expect(listRouteHandlers(repositoryRoot)).toEqual(Object.keys(reviewedHandlers).sort());
  for (const [file, review] of Object.entries(reviewedHandlers)) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    expect(missingCalls(file, text, review.mustCall), `${file} no longer calls`).toEqual([]);
  }
});

test('no route handler returns an error message or details in a body or a redirect URL', () => {
  const findings = listRouteHandlers(repositoryRoot).flatMap((file) =>
    errorLeaks(file, readFileSync(resolve(repositoryRoot, file), 'utf8')),
  );
  expect(findings).toEqual([]);
});

describe('planted violations', () => {
  test('a mechanism named only in a comment, a string or an import is no call', () => {
    const text = [
      "import { verifySameOriginJsonRequest, isUuid } from '@/lib/security/same-origin';",
      '// verifySameOriginJsonRequest(req) runs first',
      "const label = 'verifySameOriginJsonRequest()';",
      'export async function POST() { return isUuid(label) ? null : null; }',
    ].join('\n');
    expect(missingCalls('app/api/x/route.ts', text, ['verifySameOriginJsonRequest', 'isUuid'])).toEqual([
      'verifySameOriginJsonRequest',
    ]);
  });

  test('a message or details in a body, a redirect or a URL parameter is reported, a tested message is not', () => {
    const text = [
      'export async function GET(req) {',
      '  const { data, error } = await load();',
      '  if (error.message.includes("refused")) return NextResponse.json({ error: "refused" });',
      '  if (data) return NextResponse.json({ error: error.message });',
      '  const match = error.message.match(/x::(.+)/);',
      '  const address = match?.[1] ?? "";',
      '  if (address) return NextResponse.redirect(`/invite-error?email=${address}`);',
      '  if (data) return Response.json({ details: error.details });',
      '  const url = new URL(req.url);',
      '  url.searchParams.set("reason", error["message"]);',
      '  const { message } = error;',
      '  return new Response(message);',
      '}',
    ].join('\n');
    expect(errorLeaks('app/api/x/route.js', text)).toEqual([
      'app/api/x/route.js:4 returns .message',
      'app/api/x/route.js:7 returns address',
      'app/api/x/route.js:8 returns details:',
      'app/api/x/route.js:10 returns .message',
      'app/api/x/route.js:12 returns message',
    ]);
  });

  test('a route.js handler joins the inventory', () => {
    const root = mkdtempSync(join(tmpdir(), 'route-inventory-'));
    try {
      for (const [folder, name] of [
        ['app/api/a', 'route.js'],
        ['app/api/b', 'route.ts'],
        ['app/c', 'page.tsx'],
      ] as const) {
        mkdirSync(join(root, folder), { recursive: true });
        writeFileSync(join(root, folder, name), '');
      }
      expect(listRouteHandlers(root)).toEqual(['app/api/a/route.js', 'app/api/b/route.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
