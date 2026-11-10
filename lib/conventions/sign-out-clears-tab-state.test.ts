// Rule test: every sign-out of the browser's own session clears the tab's queued manual entries
// and the service worker's caches.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "signing out leaves no queued time entry in the tab"
// (werk-flow/werkflow-planning#242). The manual entry bridge keeps entries in
// sessionStorage until the calendar reads them, and sessionStorage outlives a
// sign-out. Every module that ends the browser's own session with
// `auth.signOut` therefore also calls `clearManualEntryBridge`. A sign-out of
// the other sessions (`scope: 'others'`) keeps this tab signed in and needs no
// clear. A route handler runs on the server and cannot reach the tab's storage.
//
// The same modules call `clearServiceWorkerCaches`, so nothing one person saw
// stays in a cache on a shared device (werk-flow/werkflow-planning#316;
// docs/technical/security.md, Browser).
//
// The menu sign-out sits in a chunk every page loads at startup, so the clear
// lives in a module that imports nothing. Importing the bridge's schemas there
// added a startup script to every page (werk-flow/werkflow-app#232).

const CLEAR_CALL = 'clearManualEntryBridge';
const CACHE_CLEAR_CALL = 'clearServiceWorkerCaches';
const CLEAR_MODULE = 'lib/time-tracking/manual-entry-bridge-storage.ts';

/** True when the call is `<client>.auth.signOut(...)` and ends this browser's session. */
function endsOwnSession(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'signOut') return false;
  if (!ts.isPropertyAccessExpression(callee.expression) || callee.expression.name.text !== 'auth')
    return false;
  const [options] = node.arguments;
  if (!options || !ts.isObjectLiteralExpression(options)) return true;
  return !options.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'scope' &&
      ts.isStringLiteral(property.initializer) &&
      property.initializer.text === 'others',
  );
}

function calls(node: ts.CallExpression, name: string): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === name;
}

/** Whether the module ends the browser's own session, and whether it clears the queue and the caches. */
function signOutUse(
  fileName: string,
  text?: string,
): { signsOut: boolean; clears: boolean; clearsCaches: boolean } {
  const source = parseProductSource(fileName, text);
  const use = { signsOut: false, clears: false, clearsCaches: false };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (endsOwnSession(node)) use.signsOut = true;
      if (calls(node, CLEAR_CALL)) use.clears = true;
      if (calls(node, CACHE_CLEAR_CALL)) use.clearsCaches = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return use;
}

function isRouteHandler(file: string): boolean {
  return /(^|\/)route\.ts$/.test(file);
}

/** The browser modules that sign out without one of the clears, with the clear they miss. */
function signOutsWithoutClear(): string[] {
  return listProductSources()
    .filter((file) => !isRouteHandler(file))
    .flatMap((file) => {
      const use = signOutUse(file);
      if (!use.signsOut) return [];
      return [
        ...(use.clears ? [] : [`${file}: ${CLEAR_CALL}`]),
        ...(use.clearsCaches ? [] : [`${file}: ${CACHE_CLEAR_CALL}`]),
      ];
    });
}

describe('sign-out clears the tab state', () => {
  test('every browser sign-out of the own session clears the queued manual entries and the service worker caches', () => {
    expect(signOutsWithoutClear()).toEqual([]);
  });

  test('the clear imports nothing, so a sign-out adds no startup script to a page', () => {
    expect(parseProductSource(CLEAR_MODULE).statements.filter(ts.isImportDeclaration)).toEqual([]);
  });

  test('probes: a sign-out without a clear is reported, one with both or of other sessions is not', () => {
    const probe = (body: string) => `export async function probe() { ${body} }`;
    for (const body of [
      "await supabase.auth.signOut({ scope: 'global' });",
      "await supabase.auth.signOut({ scope: 'local' });",
      'await supabase.auth.signOut();',
      'await client.auth.signOut(options);',
    ]) {
      expect(signOutUse('components/probe.ts', probe(body)), body).toEqual({
        signsOut: true,
        clears: false,
        clearsCaches: false,
      });
    }
    expect(
      signOutUse(
        'components/probe.ts',
        probe(
          "clearManualEntryBridge(); await clearServiceWorkerCaches(); await supabase.auth.signOut({ scope: 'global' });",
        ),
      ),
    ).toEqual({ signsOut: true, clears: true, clearsCaches: true });
    expect(
      signOutUse('components/probe.ts', probe("await supabase.auth.signOut({ scope: 'others' });")),
    ).toEqual({
      signsOut: false,
      clears: false,
      clearsCaches: false,
    });
  });
});
