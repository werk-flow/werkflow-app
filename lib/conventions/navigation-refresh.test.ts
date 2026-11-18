import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// A navigation renders its target route fresh. A `router.refresh()` right
// after `router.push()` or `router.replace()` is a second navigation to the
// same route: Next 16 lets the refresh take over the pending push, so the
// page waits on two requests where one would do. A run proved it leaves the
// target on its loading skeletons (werk-flow/werkflow-planning#29: CI run
// 43621163292, audit:wave-1:a2-anfragen, after an Anfrage was created).
// The check reports a refresh statement that follows a statement navigating
// in the same block, unless the navigation returns at once: it sits in a
// `return`, or it is a statement of its own followed by a `return`. Any other way out
// (`throw`, `break`, `continue`, a later `return`) counts as reaching the
// refresh, since a `catch` or a jump can carry the path past that `return`.

/** Reviewed navigations followed by a refresh. Shrink-only. */
const REVIEWED_NAVIGATION_REFRESHES: readonly { file: string; reason: string }[] = [
  {
    file: 'app/(auth)/login/login-form.tsx',
    reason: 'a sign-in: the refresh drops route-cache entries rendered for the signed-out session',
  },
  {
    file: 'components/otp-form.tsx',
    reason: 'a sign-in: the refresh drops route-cache entries rendered for the signed-out session',
  },
  {
    file: 'hooks/use-sign-out.ts',
    reason: 'a sign-out: the refresh drops route-cache entries rendered for the signed-in session',
  },
];

type Finding = { file: string; line: number };

function routerCall(node: ts.Node, methods: ReadonlySet<string>): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    methods.has(node.expression.name.text) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'router'
  );
}

const NAVIGATIONS = new Set(['push', 'replace']);
const REFRESH = new Set(['refresh']);

/**
 * Whether the function returns right at the navigation, inside `statement`:
 * the navigation's own statement is a `return`, or the navigation is a
 * statement of its own and the next statement in its block is a `return`, and
 * no `try` encloses it. Only that next statement counts: a
 * `break`, `continue` or `throw` before a later `return` can jump past it.
 */
function returnsAt(navigation: ts.Node, statement: ts.Statement): boolean {
  // Inside a `try`, a `finally` can cancel the `return` and a `catch` can go on
  // to the refresh, so no `return` there ends the path.
  for (let node: ts.Node = navigation; ; node = node.parent) {
    if (ts.isTryStatement(node)) return false;
    if (node === statement) break;
  }
  // Nested functions are skipped, so the nearest statement lies within `statement`.
  let own: ts.Node = navigation;
  while (!ts.isStatement(own)) own = own.parent;
  if (ts.isReturnStatement(own)) return true;
  // Only a statement that is the navigation itself (`router.push(x);`, maybe
  // awaited or voided): in a condition or another compound statement, its own
  // body can jump past the next `return` (`if ((router.push(x), x)) break;`).
  let expression: ts.Node | undefined = ts.isExpressionStatement(own) ? own.expression : undefined;
  while (
    expression !== undefined &&
    (ts.isAwaitExpression(expression) ||
      ts.isVoidExpression(expression) ||
      ts.isParenthesizedExpression(expression))
  )
    expression = expression.expression;
  if (expression !== navigation) return false;
  const { parent } = own;
  if (!ts.isBlock(parent) && !ts.isCaseOrDefaultClause(parent)) return false;
  const next = parent.statements[parent.statements.findIndex((sibling) => sibling === own) + 1];
  return next !== undefined && ts.isReturnStatement(next);
}

/**
 * Whether the statement calls `router.push` or `router.replace` outside a
 * nested function on a path that can reach the statement's end. Strict: only
 * a `return` at the navigation ends its path, so a branch that leaves another
 * way (a `throw`, a jump, an inner `if` that returns on every path, a `return`
 * after another statement, a call that never returns) still counts as
 * reaching a later refresh.
 */
function navigates(statement: ts.Statement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (routerCall(node, NAVIGATIONS)) found = !returnsAt(node, statement);
    else ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

function findNavigationRefreshes(sources: ReadonlyMap<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of sources) {
    if (!/\brouter\s*\.\s*refresh\s*\(/.test(text)) continue;
    const sourceFile = parseProductSource(file, text);
    const visit = (node: ts.Node): void => {
      if (ts.isBlock(node)) {
        node.statements.forEach((statement, index) => {
          if (
            ts.isExpressionStatement(statement) &&
            routerCall(statement.expression, REFRESH) &&
            node.statements.slice(0, index).some(navigates)
          )
            findings.push({
              file,
              line: sourceFile.getLineAndCharacterOfPosition(statement.getStart()).line + 1,
            });
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

test('a router.refresh() never follows a router.push() or router.replace() in the same block', () => {
  const findings = findNavigationRefreshes(productSources()).filter(
    ({ file }) => !REVIEWED_NAVIGATION_REFRESHES.some((entry) => entry.file === file),
  );
  expect(findings.map(({ file, line }) => `${file}:${line} refreshes after a navigation`)).toEqual([]);
});

test('every reviewed navigation refresh still exists', () => {
  const findings = findNavigationRefreshes(productSources());
  expect(
    REVIEWED_NAVIGATION_REFRESHES.filter((entry) => !findings.some((finding) => finding.file === entry.file)),
  ).toEqual([]);
});

test('the check reports a refresh after a navigation and passes a refresh in place of one', () => {
  const source = [
    "'use client';",
    "import { useRouter } from 'next/navigation';",
    'export function useCreate() {',
    '  const router = useRouter();',
    '  const onCreated = (id: string) => {',
    '    router.push(`/anfragen/${id}`);',
    '    router.refresh();',
    '  };',
    '  const onSwitched = (parent: string | null) => (parent ? router.push(parent) : router.refresh());',
    '  const onSaved = () => {',
    '    router.refresh();',
    '  };',
    '  return { onCreated, onSwitched, onSaved };',
    '}',
  ].join('\n');
  expect(findNavigationRefreshes(new Map([['components/anfragen/use-create.ts', source]]))).toEqual([
    { file: 'components/anfragen/use-create.ts', line: 7 },
  ]);
});

test('the check passes a refresh after a branch that navigates and returns, and reports one after a branch that stays or throws', () => {
  const source = [
    'export function useLeave(router: { push: (href: string) => void; refresh: () => void }) {',
    '  const onReturned = (parent: string | null) => {',
    '    if (parent) {',
    '      router.push(parent);',
    '      return;',
    '    }',
    '    router.refresh();',
    '  };',
    '  const onReturnedInline = (parent: string | null) => {',
    '    if (parent) return router.push(parent);',
    '    router.refresh();',
    '  };',
    '  const onThrown = (parent: string | null) => {',
    '    if (!parent) {',
    "      router.push('/anfragen');",
    "      throw new Error('kein Ziel');",
    '    }',
    '    router.refresh();',
    '  };',
    '  const onStayed = (parent: string | null) => {',
    '    if (parent) {',
    '      router.push(parent);',
    '    } else {',
    '      return;',
    '    }',
    '    router.refresh();',
    '  };',
    '  const onNested = (parent: string | null, done: boolean) => {',
    '    if (parent) {',
    '      router.push(parent);',
    '      if (done) return;',
    '    }',
    '    router.refresh();',
    '  };',
    '  const onCaught = (parent: string | null) => {',
    '    if (parent) {',
    '      try {',
    '        router.push(parent);',
    "        throw new Error('fehlgeschlagen');",
    '      } catch {',
    '        // weiter',
    '      }',
    '    }',
    '    router.refresh();',
    '  };',
    '  const onFinally = (parent: string | null) => {',
    '    if (parent) {',
    '      try {',
    '        try {',
    '          router.push(parent);',
    '          return;',
    '        } finally {',
    "          throw new Error('fehlgeschlagen');",
    '        }',
    '      } catch {',
    '        // weiter',
    '      }',
    '    }',
    '    router.refresh();',
    '  };',
    '  return { onReturned, onReturnedInline, onThrown, onStayed, onNested, onCaught, onFinally };',
    '}',
  ].join('\n');
  expect(findNavigationRefreshes(new Map([['hooks/use-leave.ts', source]]))).toEqual([
    { file: 'hooks/use-leave.ts', line: 18 },
    { file: 'hooks/use-leave.ts', line: 26 },
    { file: 'hooks/use-leave.ts', line: 33 },
    { file: 'hooks/use-leave.ts', line: 44 },
    { file: 'hooks/use-leave.ts', line: 59 },
  ]);
});

test('the check reports a refresh after a navigation whose return comes after another statement', () => {
  const source = [
    'export function useJump(router: { push: (href: string) => void; refresh: () => void }, hrefs: string[]) {',
    '  const onLooped = () => {',
    '    for (const href of hrefs) {',
    '      if (href) {',
    '        router.push(href);',
    '        break;',
    '      }',
    '      return;',
    '    }',
    '    router.refresh();',
    '  };',
    '  const onBroken = () => {',
    '    for (const href of hrefs) {',
    '      router.push(href);',
    '      break;',
    '      return;',
    '    }',
    '    router.refresh();',
    '  };',
    '  const onLater = (href: string, done: boolean) => {',
    '    if (href) {',
    '      router.push(href);',
    '      if (done) {',
    '      }',
    '      return;',
    '    }',
    '    router.refresh();',
    '  };',
    '  const onCondition = () => {',
    '    for (const href of hrefs) {',
    '      if ((router.push(href), href)) break;',
    '      return;',
    '    }',
    '    router.refresh();',
    '  };',
    '  return { onLooped, onBroken, onLater, onCondition };',
    '}',
  ].join('\n');
  expect(findNavigationRefreshes(new Map([['hooks/use-jump.ts', source]]))).toEqual([
    { file: 'hooks/use-jump.ts', line: 10 },
    { file: 'hooks/use-jump.ts', line: 18 },
    { file: 'hooks/use-jump.ts', line: 27 },
    { file: 'hooks/use-jump.ts', line: 34 },
  ]);
});

test('the check reads a refresh call spread over lines', () => {
  const source = [
    'export function useLeave(router: { replace: (href: string) => void; refresh: () => void }) {',
    '  return () => {',
    "    router.replace('/');",
    '    router',
    '      .refresh( );',
    '  };',
    '}',
  ].join('\n');
  expect(findNavigationRefreshes(new Map([['hooks/use-leave.ts', source]]))).toEqual([
    { file: 'hooks/use-leave.ts', line: 4 },
  ]);
});
