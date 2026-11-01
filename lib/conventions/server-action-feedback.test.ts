import { expect, test } from 'bun:test';
import ts from 'typescript';
import { parseProductSource } from './product-sources';
import {
  actionImports,
  FEEDBACK_OWNER_HOOKS,
  findClientModules,
  isImmediatelyInvoked,
  parsedSources,
  PENDING_FLAG_SETTER,
  PENDING_SUBJECT_SETTER,
  sourceOf,
  type ModuleImport,
} from './server-action-feedback-scan';
import { isReadAction, READ_CALLS } from './server-action-reads';

// One owner for pending state (AGENTS.md "2. Performance and immediate
// feedback"). A pending setter (PENDING_FLAG_SETTER called with `true`,
// PENDING_SUBJECT_SETTER called with a value) raised before an await or a
// `.then` that is not only a read is pending state written by hand: route the
// write through useServerAction, usePendingTask or useBusyIds instead. A
// setter that names a read (HAND_READ_SETTER) and an awaited call that only
// reads (isReadAction, `readInBackground`) stay out, and so do the modules
// that implement a FEEDBACK_OWNER_HOOKS hook. HAND_PENDING_STATE holds the
// reasoned exceptions; it may only shrink: an entry that matches no site fails.

/** "file::setterName" -> why this pending state stays hand-written. */
const HAND_PENDING_STATE: Readonly<Record<string, string>> = {
  'components/auftraege/artifacts/use-work-artifact-customer-actions.ts::setPendingSignatureDocumentId':
    'not a pending flag: it keeps the id of an uploaded signature that is not linked yet, so a retry reuses it; the write itself runs inside runArtifactTask',
  'components/auftraege/lifecycle/work-lifecycle-card.tsx::setPendingState':
    'an optimistic display value: the card shows the chosen state over the snapshot until the server answers, which a busy-id set cannot express',
  'components/inventar/use-inventory-editing.ts::setPendingItemDraft':
    'an optimistic placeholder row that the table renders until the refreshed list contains the item',
  'components/inventar/use-inventory-editing.ts::setPendingLocationDraft':
    'an optimistic placeholder card that the Lager tab renders until the refreshed list contains the location',
  'components/organization/organization-context.tsx::setIsSwitchingOrg':
    'the switch lock ends when matching server props arrive (realtime-and-caching.md, organization switch confirmation), not when the cookie write returns',
  'components/user/user-profile-context.tsx::setIsLoading':
    "the profile read's loading state: refreshProfile only reads the user and the profile row",
};

/** A setter of a read's loading state: `setIsLoadingOptions`, `setIsRefreshing`; a bare `setIsLoading` may name a write. */
const HAND_READ_SETTER = /Loading[A-Z]|Refresh|Preview|Search|Settl/;

function isOwnerImplementation(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.name.text in FEEDBACK_OWNER_HOOKS &&
      (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

/** `setIsSaving(true)` or `setEndingId(id)`; a functional update or a reset is not a raise. */
function handPendingSetter(call: ts.CallExpression): string | null {
  if (!ts.isIdentifier(call.expression)) return null;
  const name = call.expression.text;
  const [value] = call.arguments;
  if (value === undefined || HAND_READ_SETTER.test(name)) return null;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return PENDING_FLAG_SETTER.test(name) ? name : null;
  const isValue =
    value.kind !== ts.SyntaxKind.FalseKeyword &&
    value.kind !== ts.SyntaxKind.NullKeyword &&
    !ts.isArrowFunction(value) &&
    !ts.isFunctionExpression(value);
  return isValue && PENDING_SUBJECT_SETTER.test(name) ? name : null;
}

/** The name a call is known by: `save` for `save()`, `signInWithPassword` for `supabase.auth.signInWithPassword()`. */
function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
}

const CONTINUATIONS = ['then', 'catch', 'finally'];

/** The call a continuation waits for: `await save()`, `save().then(...)`, `save().finally(...)`. */
function awaitedCall(node: ts.Node): ts.CallExpression | null {
  let expression: ts.Node | null = null;
  if (ts.isAwaitExpression(node)) expression = node.expression;
  else if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    CONTINUATIONS.includes(node.expression.name.text)
  )
    expression = node.expression.expression;
  // `save().catch(...).finally(...)`: the chain waits for its first call.
  while (
    expression &&
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    CONTINUATIONS.includes(expression.expression.name.text)
  )
    expression = expression.expression.expression;
  return expression && ts.isCallExpression(expression) ? expression : null;
}

/**
 * A call that only reads: a read Server Action, or a background read. Any other
 * call, a local helper included, may write: a name like `loadX` never decides.
 */
function isReadCall(call: ts.CallExpression, actions: ReadonlyMap<string, ModuleImport>): boolean {
  const name = calleeName(call);
  if (name === null) return false;
  const action = ts.isIdentifier(call.expression) ? actions.get(name) : undefined;
  return action ? isReadAction(action.module, action.imported) : READ_CALLS.has(name);
}

/** The nodes of a function body that run in its own call: nested functions only when invoked at once. */
function ownBodyNodes(body: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  function visit(node: ts.Node): void {
    if (node !== body && ts.isFunctionLike(node) && !isImmediatelyInvoked(node)) return;
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(body);
  return nodes;
}

type HandPendingSite = { key: string; location: string };

function handPendingSites(file: string): HandPendingSite[] {
  const source = sourceOf(file);
  if (isOwnerImplementation(source)) return [];
  const actions = actionImports(file);
  const sites: HandPendingSite[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const nodes = ownBodyNodes(node.body);
      for (const call of nodes.filter(ts.isCallExpression)) {
        const setter = handPendingSetter(call);
        if (setter === null) continue;
        const raisedAt = call.getStart(source);
        const waitsForWrite = nodes.some((later) => {
          if (later.getStart(source) <= raisedAt) return false;
          const awaited = awaitedCall(later);
          return awaited !== null && !isReadCall(awaited, actions);
        });
        if (!waitsForWrite) continue;
        const line = source.getLineAndCharacterOfPosition(raisedAt).line + 1;
        sites.push({ key: `${file}::${setter}`, location: `${file}:${line} ${setter}` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return sites;
}

test('pending state of a write has one owner: the FEEDBACK_OWNER_HOOKS hooks', () => {
  const sites = findClientModules().flatMap(handPendingSites);
  const siteKeys = new Set(sites.map((site) => site.key));
  expect(
    sites.filter((site) => HAND_PENDING_STATE[site.key] === undefined).map((site) => site.location),
    'This pending state is written by hand around a write. Use the isPending of useServerAction (one action) or usePendingTask (a flow of several steps), or useBusyIds for the row or the choice that runs; hold it across a page change with untilPageLeaves(). A reasoned exception goes into HAND_PENDING_STATE.',
  ).toEqual([]);
  expect(
    Object.keys(HAND_PENDING_STATE).filter((key) => !siteKeys.has(key)),
    'These HAND_PENDING_STATE entries match no site; remove them.',
  ).toEqual([]);
});

/** The hand-written pending sites of a fixture client module. */
function fixtureHandPending(name: string, body: string): string[] {
  const file = `components/fixtures/${name}.tsx`;
  const header = [
    "'use client';",
    "import { useState } from 'react';",
    "import { getJobDetails, updateJob } from '@/lib/jobs/actions';",
  ].join('\n');
  parsedSources.set(file, parseProductSource(file, `${header}\n${body}`));
  return handPendingSites(file).map((site) => site.location.replace(/^components\/fixtures\//, ''));
}

test('the scan rejects pending state raised by hand before a write and accepts reads and resets', () => {
  const state = `export function Save({ onConfirm }: { onConfirm: () => Promise<void> }) { const [isSaving, setIsSaving] = useState(false); const [endingId, setEndingId] = useState<string | null>(null);`;
  expect(
    fixtureHandPending(
      'flag',
      `${state} return async () => { setIsSaving(true); await updateJob('j', {}); }; }`,
    ),
  ).toEqual(['flag.tsx:4 setIsSaving']);
  expect(
    fixtureHandPending(
      'subject',
      `${state} return (id: string) => { setEndingId(id); void updateJob(id, {}).finally(() => setEndingId(null)); }; }`,
    ),
  ).toEqual(['subject.tsx:4 setEndingId']);
  expect(
    fixtureHandPending(
      'callback',
      `${state} return async () => { setIsSaving(true); await onConfirm(); }; }`,
    ),
  ).toEqual(['callback.tsx:4 setIsSaving']);
  expect(
    fixtureHandPending(
      'nested',
      `${state} return () => { setIsSaving(true); void (async () => { await updateJob('j', {}); })(); }; }`,
    ),
  ).toEqual(['nested.tsx:4 setIsSaving']);
  expect(
    fixtureHandPending(
      'read',
      `${state} return async () => { setIsSaving(true); await getJobDetails('j'); }; }`,
    ),
  ).toEqual([]);
  expect(
    fixtureHandPending(
      'reset',
      `${state} return async () => { await updateJob('j', {}); setIsSaving(false); }; }`,
    ),
  ).toEqual([]);
});
