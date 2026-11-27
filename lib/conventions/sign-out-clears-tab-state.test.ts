// Rule test: every sign-out of the browser's own session clears the tab's queued manual entries,
// the service worker's caches and the today snapshot on the device; an organization switch
// clears the snapshot too.
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
// The same modules call `clearTodayOnDevice`, so no one's day stays readable
// on a shared phone, and so does the organization switch (decision record
// 0010, "Device data"; werk-flow/werkflow-planning#318).
//
// Before any of that, the same modules end through `endSessionAfterCheck`: unsent work on the
// phone is the person's work, so it is sent, or the person decides about it,
// before a session ends or the organization changes (decision record 0010,
// the amendment "the time outbox"; werk-flow/werkflow-planning#319). The check
// loads lazily behind a gate that imports only the logging.
//
// The same modules call `clearKiDrafts`, so no WerkFlow KI draft of one person
// stays in the tab for the next (werk-flow/werkflow-planning#530). It lives
// apart from the chat's draft module, which only the chat page loads.
//
// The menu sign-out sits in a chunk every page loads at startup, so each clear
// lives in a module that imports nothing. Importing the bridge's schemas there
// added a startup script to every page (werk-flow/werkflow-app#232).

const CLEAR_CALL = 'clearManualEntryBridge';
const CACHE_CLEAR_CALL = 'clearServiceWorkerCaches';
const CLEAR_MODULE = 'lib/time-tracking/manual-entry-bridge-storage.ts';
const DRAFT_CLEAR_CALL = 'clearKiDrafts';
const DRAFT_CLEAR_MODULE = 'lib/ai/chat-draft-clear.ts';
const TODAY_CLEAR_CALL = 'clearTodayOnDevice';
const TODAY_CLEAR_MODULE = 'lib/field-sync/device/today-wipe.ts';
const UNSENT_ASK_CALL = 'endSessionAfterCheck';
const UNSENT_GATE_MODULE = 'components/shared/unsent-work-gate.ts';
/** The modules that change the active organization in the browser. */
const ORGANIZATION_SWITCH_MODULES = ['components/organization/organization-context.tsx'];

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

/** Whether the module ends the browser's own session, and which of the clears it calls. */
function signOutUse(
  fileName: string,
  text?: string,
): {
  signsOut: boolean;
  clears: boolean;
  clearsCaches: boolean;
  clearsToday: boolean;
  asksUnsentWork: boolean;
  clearsDrafts: boolean;
} {
  const source = parseProductSource(fileName, text);
  const use = {
    signsOut: false,
    clears: false,
    clearsCaches: false,
    clearsToday: false,
    asksUnsentWork: false,
    clearsDrafts: false,
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (calls(node, UNSENT_ASK_CALL)) use.asksUnsentWork = true;
      if (endsOwnSession(node)) use.signsOut = true;
      if (calls(node, CLEAR_CALL)) use.clears = true;
      if (calls(node, CACHE_CLEAR_CALL)) use.clearsCaches = true;
      if (calls(node, TODAY_CLEAR_CALL)) use.clearsToday = true;
      if (calls(node, DRAFT_CLEAR_CALL)) use.clearsDrafts = true;
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
        ...(use.clearsToday ? [] : [`${file}: ${TODAY_CLEAR_CALL}`]),
        ...(use.asksUnsentWork ? [] : [`${file}: ${UNSENT_ASK_CALL}`]),
        ...(use.clearsDrafts ? [] : [`${file}: ${DRAFT_CLEAR_CALL}`]),
      ];
    });
}

describe('sign-out clears the tab state', () => {
  test('every browser sign-out of the own session asks about unsent work and clears the queued manual entries, the service worker caches and the today snapshot', () => {
    expect(signOutsWithoutClear()).toEqual([]);
  });

  test('the organization switch asks about unsent work and clears the today snapshot', () => {
    for (const file of ORGANIZATION_SWITCH_MODULES) {
      expect(signOutUse(file).clearsToday, file).toBe(true);
      expect(signOutUse(file).asksUnsentWork, file).toBe(true);
    }
  });

  // The wipe module imports nothing and every sign-out already loads it, so its session-end barrier costs no
  // script; the wall-clock interval keeps a running end's barrier fresh.
  test('the unsent-work gate imports only the logging and the wipe module, and its one lazy load is caught', () => {
    const source = parseProductSource(UNSENT_GATE_MODULE);
    expect(
      source.statements
        .filter(ts.isImportDeclaration)
        .map((statement) => statement.moduleSpecifier.getText(source)),
    ).toEqual(["'@/hooks/use-wall-clock-tick'", "'@/lib/field-sync/device/today-wipe'", "'@/lib/logging'"]);
    expect(source.text.match(/import\(/g)).toHaveLength(1);
    expect(source.text).toMatch(
      /try \{\s+const \{ settleUnsentWork \} = await import\('\.\/unsent-work-prompt'\);/,
    );
  });

  test('the clears import nothing, so a sign-out adds no startup script to a page', () => {
    for (const file of [CLEAR_MODULE, TODAY_CLEAR_MODULE]) {
      const source = parseProductSource(file);
      expect(source.statements.filter(ts.isImportDeclaration), file).toEqual([]);
      expect(source.text.includes('import('), file).toBe(false);
    }
  });

  test('the draft clear imports only the storage module every sign-out already loads', () => {
    const source = parseProductSource(DRAFT_CLEAR_MODULE);
    expect(
      source.statements
        .filter(ts.isImportDeclaration)
        .map((statement) => statement.moduleSpecifier.getText(source)),
    ).toEqual([`'@/${CLEAR_MODULE.replace(/\.ts$/, '')}'`]);
    expect(source.text.includes('import('), DRAFT_CLEAR_MODULE).toBe(false);
  });

  // The chat's own draft module carries its memory copies and the sending hand-off. Imported by a
  // sign-out, it sat in the start-up chunk and split a layout script in two for every page
  // (werk-flow/werkflow-planning#530); the sign-outs import the clear module instead.
  test('only the chat imports its draft module', () => {
    const importers = listProductSources().filter((file) =>
      parseProductSource(file)
        .statements.filter(ts.isImportDeclaration)
        .some((statement) => statement.moduleSpecifier.getText().slice(1, -1) === '@/lib/ai/chat-drafts'),
    );
    expect(importers.filter((file) => !file.startsWith('components/ki/'))).toEqual([]);
    expect(importers.length).toBeGreaterThan(0);
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
        clearsToday: false,
        asksUnsentWork: false,
        clearsDrafts: false,
      });
    }
    expect(
      signOutUse(
        'components/probe.ts',
        probe(
          "await endSessionAfterCheck(report, async () => { clearManualEntryBridge(); clearKiDrafts(); await clearServiceWorkerCaches(); await clearTodayOnDevice(); await supabase.auth.signOut({ scope: 'global' }); });",
        ),
      ),
    ).toEqual({
      signsOut: true,
      clears: true,
      clearsCaches: true,
      clearsToday: true,
      asksUnsentWork: true,
      clearsDrafts: true,
    });
    expect(
      signOutUse('components/probe.ts', probe("await supabase.auth.signOut({ scope: 'others' });")),
    ).toEqual({
      signsOut: false,
      clears: false,
      clearsCaches: false,
      clearsToday: false,
      asksUnsentWork: false,
      clearsDrafts: false,
    });
  });
});
