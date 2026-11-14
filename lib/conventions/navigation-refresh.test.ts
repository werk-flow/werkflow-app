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
// in the same block.

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

/** Whether the statement calls `router.push` or `router.replace` outside a nested function. */
function navigates(statement: ts.Statement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (routerCall(node, NAVIGATIONS)) found = true;
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
