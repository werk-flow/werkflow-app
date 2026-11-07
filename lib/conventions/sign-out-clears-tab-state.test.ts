// Rule test: every sign-out of the browser's own session clears the tab's queued manual entries.
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

const CLEAR_CALL = 'clearManualEntryBridge';

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

function callsClear(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === CLEAR_CALL;
}

/** Whether the module ends the browser's own session, and whether it clears the queue. */
function signOutUse(fileName: string, text?: string): { signsOut: boolean; clears: boolean } {
  const source = parseProductSource(fileName, text);
  const use = { signsOut: false, clears: false };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (endsOwnSession(node)) use.signsOut = true;
      if (callsClear(node)) use.clears = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return use;
}

function isRouteHandler(file: string): boolean {
  return /(^|\/)route\.ts$/.test(file);
}

/** The browser modules that sign out without clearing the queue. */
function signOutsWithoutClear(): string[] {
  return listProductSources()
    .filter((file) => !isRouteHandler(file))
    .filter((file) => {
      const use = signOutUse(file);
      return use.signsOut && !use.clears;
    });
}

describe('sign-out clears the tab state', () => {
  test('every browser sign-out of the own session clears the queued manual entries', () => {
    expect(signOutsWithoutClear()).toEqual([]);
  });

  test('probes: a sign-out without the clear is reported, one with it or of other sessions is not', () => {
    const probe = (body: string) => `export async function probe() { ${body} }`;
    for (const body of [
      "await supabase.auth.signOut({ scope: 'global' });",
      "await supabase.auth.signOut({ scope: 'local' });",
      'await supabase.auth.signOut();',
      'await client.auth.signOut(options);',
    ]) {
      expect(signOutUse('components/probe.ts', probe(body)), body).toEqual({ signsOut: true, clears: false });
    }
    expect(
      signOutUse(
        'components/probe.ts',
        probe("clearManualEntryBridge(); await supabase.auth.signOut({ scope: 'global' });"),
      ),
    ).toEqual({ signsOut: true, clears: true });
    expect(
      signOutUse('components/probe.ts', probe("await supabase.auth.signOut({ scope: 'others' });")),
    ).toEqual({
      signsOut: false,
      clears: false,
    });
  });
});
