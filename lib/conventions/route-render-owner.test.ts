import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// One save is one route render (realtime-and-caching.md, "Checklist"). In
// Next 16 a Server Action that revalidates (`revalidatePath`, `updateTag`, a
// cookie write) renders the current page into its own response
// (node_modules/next/dist/server/app-render/action-handler.js,
// `addRevalidationHeader`), so a client `router.refresh()` after it renders the
// route a second time. Each save keeps one owner: drop the client refresh, or
// drop the revalidation when it only refreshed the acting page.
//
// The check follows each `router.refresh()` to the Server Actions its
// handler uses: the innermost callback inside the component or hook that
// holds the refresh, and the module-level `const`s that callback reads (a
// `useServerAction(action)` runner). An action revalidates when its body, or
// a function it calls, calls one of REVALIDATING_CALLS or writes a cookie.
// A refresh passed across a component boundary (`onSaved={() =>
// router.refresh()}`) is not followed; the route-render ratchet of the
// browser journeys (tests/golden/route-renders.json) counts those saves.

const REVALIDATING_CALLS = new Set(['revalidatePath', 'updateTag']);

// The Supabase server client writes the session cookies only when the auth
// token was refreshed during the request, which a save cannot plan for; an
// explicit cookie write anywhere else counts.
const SESSION_COOKIE_MODULE = 'lib/supabase/server.ts';

/** Reviewed pairs of a client refresh and a revalidating action. Shrink-only. */
const REVIEWED_DOUBLE_RENDERS: readonly { file: string; action: string; reason: string }[] = [
  {
    file: 'app/(auth)/signup/signup-form.tsx',
    action: 'invalidateProfileCache',
    reason:
      'a navigation, not a save: sign-up leaves for /verify, and the refresh drops the signed-out route cache',
  },
  {
    file: 'components/organization/organization-context.tsx',
    action: 'setActiveOrgCookie',
    reason:
      'a navigation, not a save: the organization switch refreshes inside a transition that keeps the overlay until the new organization renders',
  },
];

type Finding = { file: string; line: number; action: string };

function resolveModule(from: string, specifier: string, files: ReadonlySet<string>): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = specifier.slice(2);
  else if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), specifier));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`])
    if (files.has(candidate)) return candidate;
  return null;
}

/** Local value imports of a module: local name -> { module, exported name }. */
function importsOf(
  sourceFile: ts.SourceFile,
  files: ReadonlySet<string>,
): Map<string, { module: string; name: string }> {
  const imports = new Map<string, { module: string; name: string }>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const target = resolveModule(sourceFile.fileName, statement.moduleSpecifier.text, files);
    const bindings = statement.importClause?.namedBindings;
    if (!target || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      imports.set(element.name.text, { module: target, name: (element.propertyName ?? element.name).text });
    }
  }
  return imports;
}

/** Top-level functions of a module by name: declarations and `const` arrows or function expressions. */
function topLevelFunctions(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const functions = new Map<string, ts.Node>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body)
      functions.set(statement.name.text, statement.body);
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          functions.set(declaration.name.text, declaration.initializer);
  }
  return functions;
}

function isCookieWrite(call: ts.CallExpression): boolean {
  const callee = call.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === 'set' || callee.name.text === 'delete') &&
    /cookie/i.test(callee.expression.getText())
  );
}

/** Every function key `<module>#<name>` that revalidates, directly or through a function it calls. */
function revalidatingFunctions(parsed: ReadonlyMap<string, ts.SourceFile>): Set<string> {
  const files = new Set(parsed.keys());
  const calls = new Map<string, Set<string>>();
  const revalidating = new Set<string>();
  for (const [file, sourceFile] of parsed) {
    if (!file.startsWith('lib/')) continue;
    const imports = importsOf(sourceFile, files);
    const local = topLevelFunctions(sourceFile);
    for (const [name, body] of local) {
      const key = `${file}#${name}`;
      const callees = new Set<string>();
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          if (ts.isIdentifier(callee)) {
            if (REVALIDATING_CALLS.has(callee.text)) revalidating.add(key);
            const imported = imports.get(callee.text);
            if (imported) callees.add(`${imported.module}#${imported.name}`);
            else if (local.has(callee.text)) callees.add(`${file}#${callee.text}`);
          }
          if (file !== SESSION_COOKIE_MODULE && isCookieWrite(node)) revalidating.add(key);
        }
        ts.forEachChild(node, visit);
      };
      visit(body);
      calls.set(key, callees);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [key, callees] of calls) {
      if (revalidating.has(key)) continue;
      if ([...callees].some((callee) => revalidating.has(callee))) {
        revalidating.add(key);
        changed = true;
      }
    }
  }
  return revalidating;
}

function isServerModule(sourceFile: ts.SourceFile): boolean {
  const [first] = sourceFile.statements;
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  );
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
}

function functionDepth(node: ts.Node): number {
  let depth = 0;
  for (let current = node.parent; current; current = current.parent) if (isFunctionLike(current)) depth += 1;
  return depth;
}

/** The callback directly inside the component or hook that holds the node, or that function itself. */
function handlerOf(node: ts.Node): ts.Node | null {
  const chain: ts.Node[] = [];
  for (let current = node.parent; current; current = current.parent)
    if (isFunctionLike(current)) chain.push(current);
  return chain.length >= 2 ? (chain[chain.length - 2] ?? null) : (chain[0] ?? null);
}

function isRouterRefresh(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 0 &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'refresh' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'router'
  );
}

/** Pairs of a client `router.refresh()` and a revalidating Server Action its handler uses. */
function findDoubleRenders(sources: ReadonlyMap<string, string>): Finding[] {
  const parsed = new Map([...sources].map(([file, text]) => [file, parseProductSource(file, text)] as const));
  const files = new Set(parsed.keys());
  const revalidating = revalidatingFunctions(parsed);
  const serverModules = new Set(
    [...parsed].filter(([, sourceFile]) => isServerModule(sourceFile)).map(([file]) => file),
  );
  const findings: Finding[] = [];
  for (const [file, sourceFile] of parsed) {
    if (file.startsWith('lib/') || !/\brouter\.refresh\(\)/.test(sources.get(file) ?? '')) continue;
    const imports = importsOf(sourceFile, files);
    // Only the consts of a component or hook body: a handler's own locals stay its own.
    const componentConsts = new Map<string, ts.Node>();
    const collectConsts = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer && functionDepth(node) <= 1) {
        if (ts.isIdentifier(node.name)) componentConsts.set(node.name.text, node.initializer);
        else if (ts.isObjectBindingPattern(node.name))
          for (const element of node.name.elements)
            if (ts.isIdentifier(element.name)) componentConsts.set(element.name.text, node.initializer);
      }
      ts.forEachChild(node, collectConsts);
    };
    collectConsts(sourceFile);
    const visit = (node: ts.Node): void => {
      if (isRouterRefresh(node)) {
        const handler = handlerOf(node);
        const actions = new Set<string>();
        const seen = new Set<ts.Node>();
        const collect = (scope: ts.Node, depth: number): void => {
          if (seen.has(scope)) return;
          seen.add(scope);
          const walk = (inner: ts.Node): void => {
            if (ts.isIdentifier(inner)) {
              const imported = imports.get(inner.text);
              if (imported && serverModules.has(imported.module))
                actions.add(`${imported.module}#${imported.name}`);
              const local = componentConsts.get(inner.text);
              if (local && depth < 2) collect(local, depth + 1);
            }
            ts.forEachChild(inner, walk);
          };
          walk(scope);
        };
        if (handler) collect(handler, 0);
        for (const action of actions)
          if (revalidating.has(action))
            findings.push({
              file,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              action: action.split('#')[1] ?? action,
            });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return findings;
}

function productSources(): Map<string, string> {
  return new Map(
    listProductSources().map((file) => [file, readFileSync(resolve(repositoryRoot, file), 'utf8')] as const),
  );
}

const isReviewed = ({ file, action }: Finding): boolean =>
  REVIEWED_DOUBLE_RENDERS.some((entry) => entry.file === file && entry.action === action);

test('a client router.refresh() never follows a Server Action that already re-rendered the route', () => {
  const findings = findDoubleRenders(productSources()).filter((finding) => !isReviewed(finding));
  expect(findings.map(({ file, line, action }) => `${file}:${line} refreshes after ${action}`)).toEqual([]);
});

test('every reviewed double render still exists', () => {
  const findings = findDoubleRenders(productSources());
  const stale = REVIEWED_DOUBLE_RENDERS.filter(
    (entry) => !findings.some((finding) => finding.file === entry.file && finding.action === entry.action),
  );
  expect(stale).toEqual([]);
});

test('the check reports a refresh after a revalidating action and passes one after a plain action', () => {
  const sources = new Map([
    [
      'lib/inventory/write-support.ts',
      "import { revalidatePath } from 'next/cache';\nexport function invalidateInventory() { revalidatePath('/inventar', 'layout'); }\n",
    ],
    [
      'lib/inventory/actions.ts',
      "'use server';\nimport { invalidateInventory } from './write-support';\nexport async function upsertInventoryItem() { invalidateInventory(); return { success: true }; }\nexport async function readInventoryItem() { return { success: true }; }\n",
    ],
    [
      'components/inventar/use-inventory-editing.ts',
      "'use client';\nimport { useRouter } from 'next/navigation';\nimport { useServerAction } from '@/hooks/use-server-action';\nimport { upsertInventoryItem, readInventoryItem } from '@/lib/inventory/actions';\nexport function useInventoryEditing() {\n  const router = useRouter();\n  const save = useServerAction(upsertInventoryItem);\n  const onSave = async () => { const result = await save.run(); if (result.success) router.refresh(); };\n  const onRead = async () => { await readInventoryItem(); router.refresh(); };\n  return { onSave, onRead };\n}\n",
    ],
  ]);
  expect(findDoubleRenders(sources)).toEqual([
    { file: 'components/inventar/use-inventory-editing.ts', line: 8, action: 'upsertInventoryItem' },
  ]);
});
