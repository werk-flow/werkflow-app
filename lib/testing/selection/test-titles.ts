import ts from 'typescript';

// The titles an evidence file declares. The coverage map names the test that
// proves a catalog clause by one of these titles, so a renamed or deleted test
// fails the coverage check instead of leaving a file-level claim behind.

type TitleKind = 'describe' | 'test' | 'step' | 'sql';
export interface DeclaredTitle {
  kind: TitleKind;
  title: string;
}

const TEST_CALLEES = new Set(['test', 'it']);
const DESCRIBE_CALLEES = new Set(['describe']);
const MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow', 'serial', 'parallel', 'todo', 'if']);

/** The callee chain of `test.describe.serial(...)` as ['test', 'describe', 'serial']. */
function calleeChain(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression))
    return [...calleeChain(expression.expression), expression.name.text];
  if (ts.isCallExpression(expression)) return calleeChain(expression.expression);
  return [];
}

function titleKind(chain: readonly string[]): TitleKind | undefined {
  const [root, ...rest] = chain;
  if (root === undefined) return undefined;
  const members = rest.filter((member) => !MODIFIERS.has(member));
  if (DESCRIBE_CALLEES.has(root) && members.length === 0) return 'describe';
  if (!TEST_CALLEES.has(root)) return undefined;
  if (members.length === 0) return 'test';
  if (members.length === 1 && members[0] === 'describe') return 'describe';
  if (members.length === 1 && members[0] === 'step') return 'step';
  return undefined;
}

/** A literal title, or a template title with `${…}` standing for each substitution. */
function literalTitle(argument: ts.Expression | undefined): string | undefined {
  if (argument === undefined) return undefined;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  if (!ts.isTemplateExpression(argument)) return undefined;
  return argument.head.text + argument.templateSpans.map((span) => '${…}' + span.literal.text).join('');
}

/** Test, describe and step titles of a TypeScript or JavaScript test file. */
function scriptTestTitles(file: string, text: string): DeclaredTitle[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const titles: DeclaredTitle[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const kind = titleKind(calleeChain(node.expression));
      const title = kind === undefined ? undefined : literalTitle(node.arguments[0]);
      if (kind !== undefined && title !== undefined) titles.push({ kind, title });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return titles;
}

/**
 * The failure messages of an SQL assertion file: the first literal of each
 * `raise exception`. One message raised from two branches is one assertion, and a commented-out
 * assertion is none.
 */
function sqlAssertionTitles(text: string): DeclaredTitle[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
  const messages = [...code.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)].flatMap(([, message]) =>
    message === undefined ? [] : [message.replaceAll("''", "'")],
  );
  return [...new Set(messages)].map((title) => ({ kind: 'sql', title }));
}

export function declaredTitles(file: string, text: string): DeclaredTitle[] {
  return file.endsWith('.sql') ? sqlAssertionTitles(text) : scriptTestTitles(file, text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A title answers a reference when it equals it, or carries it as a whole tag or phrase. */
function titleCarries(title: string, reference: string): boolean {
  if (title === reference) return true;
  return new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp(reference)}(?![\\p{L}\\p{N}-])`, 'u').test(title);
}

/**
 * The declared titles a reference names. An exact title wins; otherwise the
 * reference is a tag or phrase that must occur in exactly one declared title.
 */
export function resolveTitleReference(titles: readonly DeclaredTitle[], reference: string): DeclaredTitle[] {
  const exact = titles.filter((declared) => declared.title === reference);
  if (exact.length > 0) return exact;
  return titles.filter((declared) => titleCarries(declared.title, reference));
}
