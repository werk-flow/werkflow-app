// Rule test: the shared (app) layout reaches none of the WerkFlow KI chat's code, statically or
// through `import()`. Every role's cold start loads the layout's chunks, and the bundler packs
// them together with every chunk group the layout roots, lazy ones included. The chat page's
// skeleton, which the organization-switch overlay loads lazily, imported the chat's timeline,
// so the chat's rows took part in packing the layout's chunks for people who never see WerkFlow
// KI (werk-flow/werkflow-planning#533). The chat's code loads with the chat route alone; its
// skeletons live in components/loading-states/.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import {
  moduleSpecifierOf,
  repositorySources,
  resolveProductModule,
  type SourceHost,
} from './module-imports';
import { parseProductSource } from './product-sources';

const APP_LAYOUT = 'app/(app)/layout.tsx';
/** The chat's own code: its components, its live protocol, its row helpers and its drafts. */
const CHAT_CODE = ['components/ki/', 'lib/ai/live/', 'lib/ui/ki-rows.ts', 'lib/ai/chat-drafts.ts'];

const isChatCode = (file: string): boolean => CHAT_CODE.some((prefix) => file.startsWith(prefix));

/** Whether a declaration brings no code: `import type`, `export type`, or only inline `type` bindings. */
function typeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    const bindings = clause.namedBindings;
    return (
      clause.isTypeOnly ||
      (clause.name === undefined &&
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((element) => element.isTypeOnly))
    );
  }
  const clause = node.exportClause;
  return (
    node.isTypeOnly ||
    (clause !== undefined &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((element) => element.isTypeOnly))
  );
}

/** The product modules a module loads: static imports, re-exports and `import('...')` calls. */
function loadedModules(file: string, host: SourceHost): string[] {
  const text = host(file);
  if (text === null) return [];
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = moduleSpecifierOf(node);
      if (specifier !== null && !typeOnly(node)) specifiers.push(specifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parseProductSource(file, text));
  return specifiers.flatMap((specifier) => {
    const target = resolveProductModule(file, specifier, host);
    return target === null ? [] : [target];
  });
}

/** Each chat module the layout reaches first, with the import path that reaches it. */
function chatCodeReached(layout: string, host: SourceHost): string[] {
  const path = new Map<string, string>([[layout, layout]]);
  const queue = [layout];
  const found: string[] = [];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const target of loadedModules(file, host)) {
      if (path.has(target)) continue;
      const reached = `${path.get(file) ?? file} -> ${target}`;
      path.set(target, reached);
      if (isChatCode(target)) found.push(reached);
      else queue.push(target);
    }
  }
  return found;
}

describe('the (app) layout reaches none of the WerkFlow KI chat', () => {
  test("the layout's static and lazy imports reach no chat module", () => {
    expect(chatCodeReached(APP_LAYOUT, repositorySources)).toEqual([]);
  });

  const files: Record<string, string> = {
    'app/(app)/lazy-layout.tsx': [
      "import { load } from '@/components/shell/overlay';",
      "import type { KiRow } from '@/components/ki/row';",
      "import { type KiRow as Row } from '@/components/ki/row';",
    ].join('\n'),
    'components/shell/overlay.tsx':
      "export const load = () => import('@/components/loading-states/ki-skeleton');",
    'components/loading-states/ki-skeleton.tsx':
      "import { KiTimelineSkeleton } from '@/components/ki/timeline';",
    'components/ki/timeline.tsx': "export { KiRow } from './row';",
    'components/ki/row.tsx': 'export function KiRow() {}',
    'app/(app)/static-layout.tsx': "export { KiRow } from '@/components/ki/row';",
    'app/(app)/clean-layout.tsx': "import { load } from '@/components/shell/clean-overlay';",
    'components/shell/clean-overlay.tsx':
      "export const load = () => import('@/components/loading-states/clean-skeleton');",
    'components/loading-states/clean-skeleton.tsx': "import { Skeleton } from '@/components/ui/skeleton';",
    'components/ui/skeleton.tsx': 'export function Skeleton() {}',
  };
  const host: SourceHost = (file) => files[file] ?? null;

  test('probes: a chat module behind a lazy skeleton or a re-export is reported; type-only imports and a clean skeleton are not', () => {
    expect(chatCodeReached('app/(app)/lazy-layout.tsx', host)).toEqual([
      'app/(app)/lazy-layout.tsx -> components/shell/overlay.tsx -> components/loading-states/ki-skeleton.tsx -> components/ki/timeline.tsx',
    ]);
    expect(chatCodeReached('app/(app)/static-layout.tsx', host)).toEqual([
      'app/(app)/static-layout.tsx -> components/ki/row.tsx',
    ]);
    expect(chatCodeReached('app/(app)/clean-layout.tsx', host)).toEqual([]);
  });
});
