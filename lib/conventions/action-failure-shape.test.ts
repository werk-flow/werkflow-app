import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "one result shape" (docs/technical/code-quality.md). Every
// Server Action and reader returns `ActionResult` or `ActionFailure` from
// lib/action-result.ts and fails with a stable snake_case code:
// - a hand-written `{ success: false; ... }` type literal is a second failure
//   shape; a richer failure is `ActionFailure<Code> & { extra: T }`;
// - a `success: boolean` or `ok: boolean` flag cannot be narrowed, so a caller
//   reads fields that a failure does not carry;
// - every exported function of a 'use server' module declares
//   `Promise<Result>`, where Result is ActionResult, ActionFailure, a success
//   arm `{ success: true; ... }`, an `Extract` of one, an intersection that
//   holds one, a union of these, `never`, or a type alias declared as one of
//   these (aliases resolve by name across the product sources);
// - a failure literal `{ success: false, error: ... }` names a code such as
//   `load_failed`, never a sentence and never a code with a payload glued on:
//   extra facts travel as fields beside the code.

const FAILURE_SHAPE_HOME = 'lib/action-result.ts';
const RESULT_HOMES = new Set(['ActionResult', 'ActionFailure']);
const FAILURE_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * Reviewed Server Actions outside the shape, by `file#name`. Shrink-only: the
 * test fails on an entry that no longer exists or now conforms.
 */
const REVIEWED_RESULT_EXCEPTIONS: Readonly<Record<string, string>> = {
  'lib/time-corrections/read-actions.ts#getProvisionalTimeCorrectionProjection':
    'A server-side projection the time-tracking entry reads merge in; it answers an empty projection to a caller without access. Converting it changes those readers, which the time-tracking split moves in the same package.',
};

type Finding = { file: string; line: number; text: string };

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function propertyType(member: ts.TypeElement, name: string): ts.TypeNode | undefined {
  return ts.isPropertySignature(member) && member.name.getText() === name ? member.type : undefined;
}

function isLiteralOf(node: ts.TypeNode | undefined, kind: ts.SyntaxKind): boolean {
  return node !== undefined && ts.isLiteralTypeNode(node) && node.literal.kind === kind;
}

/**
 * A type literal in a result position: it carries an `error` member, or it is
 * the awaited type of a Promise or a generic constraint. A component prop that
 * only reports whether a read succeeded is not a result.
 */
function isResultPosition(node: ts.TypeLiteralNode): boolean {
  if (node.members.some((member) => propertyType(member, 'error') !== undefined)) return true;
  for (let current: ts.Node = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isTypeReferenceNode(current) && current.typeName.getText() === 'Promise') return true;
    if (ts.isTypeParameterDeclaration(current)) return true;
    if (
      !ts.isUnionTypeNode(current) &&
      !ts.isIntersectionTypeNode(current) &&
      !ts.isParenthesizedTypeNode(current)
    )
      return false;
  }
  return false;
}

/** Type literals that declare `success: false`, or a `success` or `ok` flag typed `boolean` in a result position. */
function resultLiteralFindings(file: string, text?: string): Finding[] {
  const source = parseProductSource(file, text);
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        const success = propertyType(member, 'success');
        if (file !== FAILURE_SHAPE_HOME && isLiteralOf(success, ts.SyntaxKind.FalseKeyword))
          findings.push({ file, line: lineOf(source, node), text: 'success: false' });
        for (const [name, type] of [
          ['success', success],
          ['ok', propertyType(member, 'ok')],
        ] as const) {
          if (type?.kind === ts.SyntaxKind.BooleanKeyword && isResultPosition(node))
            findings.push({ file, line: lineOf(source, node), text: `${name}: boolean` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** `{ success: false, error: <literal> }` objects whose error is not a plain code. */
function failureCodeFindings(file: string, text?: string): Finding[] {
  const source = parseProductSource(file, text);
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      let failed = false;
      let error: ts.Expression | undefined;
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = property.name.getText(source);
        if (name === 'success') failed = property.initializer.kind === ts.SyntaxKind.FalseKeyword;
        if (name === 'error') error = property.initializer;
      }
      if (failed && error) {
        const sentence =
          (ts.isStringLiteral(error) || ts.isNoSubstitutionTemplateLiteral(error)) &&
          !FAILURE_CODE.test(error.text);
        if (sentence || ts.isTemplateExpression(error))
          findings.push({ file, line: lineOf(source, node), text: error.getText(source) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** Every top-level type alias of the sources, by name. */
function typeAliases(sources: ReadonlyMap<string, ts.SourceFile>): Map<string, ts.TypeNode[]> {
  const aliases = new Map<string, ts.TypeNode[]>();
  for (const source of sources.values()) {
    for (const statement of source.statements) {
      if (!ts.isTypeAliasDeclaration(statement)) continue;
      aliases.set(statement.name.text, [...(aliases.get(statement.name.text) ?? []), statement.type]);
    }
  }
  return aliases;
}

function isSuccessArm(node: ts.TypeNode): boolean {
  return (
    ts.isTypeLiteralNode(node) &&
    node.members.some((member) => isLiteralOf(propertyType(member, 'success'), ts.SyntaxKind.TrueKeyword))
  );
}

/** Whether the type is a result shape; an alias declared twice must conform in both declarations. */
function isResultType(
  node: ts.TypeNode,
  aliases: ReadonlyMap<string, ts.TypeNode[]>,
  seen: ReadonlySet<string>,
): boolean {
  if (ts.isParenthesizedTypeNode(node)) return isResultType(node.type, aliases, seen);
  if (node.kind === ts.SyntaxKind.NeverKeyword || isSuccessArm(node)) return true;
  if (ts.isUnionTypeNode(node)) return node.types.every((member) => isResultType(member, aliases, seen));
  if (ts.isIntersectionTypeNode(node))
    return node.types.some((member) => isResultType(member, aliases, seen));
  if (!ts.isTypeReferenceNode(node)) return false;
  const name = node.typeName.getText();
  if (RESULT_HOMES.has(name)) return true;
  const [narrowed] = node.typeArguments ?? [];
  if (name === 'Extract' && narrowed) return isResultType(narrowed, aliases, seen);
  const declarations = aliases.get(name);
  if (!declarations || seen.has(name)) return false;
  const inside = new Set(seen).add(name);
  return declarations.every((declaration) => isResultType(declaration, aliases, inside));
}

function isServerModule(source: ts.SourceFile): boolean {
  const [first] = source.statements;
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  );
}

const isExported = (statement: ts.FunctionDeclaration | ts.VariableStatement): boolean =>
  statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

/**
 * The exported actions of a module with their declared return types: function
 * declarations, and constants that hold an arrow function or a function
 * expression (the return type of the function, or of the constant's function type).
 */
function exportedActions(source: ts.SourceFile): Array<{ name: string; declared: ts.TypeNode | undefined }> {
  return source.statements.flatMap((statement) => {
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement))
      return [{ name: statement.name.text, declared: statement.type }];
    if (!ts.isVariableStatement(statement) || !isExported(statement)) return [];
    return statement.declarationList.declarations.flatMap((declaration) => {
      const initializer = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || !initializer) return [];
      if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return [];
      const annotated =
        declaration.type && ts.isFunctionTypeNode(declaration.type) ? declaration.type.type : undefined;
      return [{ name: declaration.name.text, declared: initializer.type ?? annotated }];
    });
  });
}

/** `file#name` of every exported function of a 'use server' module that does not declare `Promise<Result>`. */
function nonResultActions(sources: ReadonlyMap<string, ts.SourceFile>): string[] {
  const aliases = typeAliases(sources);
  const offending: string[] = [];
  for (const [file, source] of sources) {
    if (!isServerModule(source)) continue;
    for (const { name, declared } of exportedActions(source)) {
      const isPromise =
        declared !== undefined &&
        ts.isTypeReferenceNode(declared) &&
        declared.typeName.getText() === 'Promise';
      const [result] = isPromise ? (declared.typeArguments ?? []) : [];
      if (!result || !isResultType(result, aliases, new Set())) offending.push(`${file}#${name}`);
    }
  }
  return offending.sort();
}

const format = (findings: readonly Finding[]): string[] =>
  findings.map(({ file, line, text }) => `${file}:${line} ${text}`);

describe('one result shape', () => {
  test('no hand-written failure literal and no boolean result flag', () => {
    const findings = listProductSources().flatMap((file) => resultLiteralFindings(file));
    expect(
      format(findings),
      'Type the result as ActionResult<Data, Code> or ActionFailure<Code> from lib/action-result.ts; a richer failure is `ActionFailure<Code> & { extra: T }`.',
    ).toEqual([]);
  });

  test('a failure names a snake_case code, never a sentence', () => {
    const findings = listProductSources().flatMap((file) => failureCodeFindings(file));
    expect(
      format(findings),
      'Return a stable code such as `load_failed`; its German sentence lives in lib/action-messages.ts or the area message map, and extra facts travel as fields beside the code.',
    ).toEqual([]);
  });

  test('every Server Action declares Promise<ActionResult> or a type built from it', () => {
    const sources = new Map(listProductSources().map((file) => [file, parseProductSource(file)]));
    const offending = nonResultActions(sources);
    const reviewed = Object.keys(REVIEWED_RESULT_EXCEPTIONS);
    expect(
      offending.filter((action) => !reviewed.includes(action)),
      'Declare the return as Promise<ActionResult<Data, Code>> or an alias built from ActionResult and ActionFailure.',
    ).toEqual([]);
    expect(
      reviewed.filter((action) => !offending.includes(action)),
      'Remove the stale entries from REVIEWED_RESULT_EXCEPTIONS.',
    ).toEqual([]);
  });
});

describe('planted violations', () => {
  const planted = (text: string): Map<string, ts.SourceFile> =>
    new Map([['lib/probe/actions.ts', parseProductSource('lib/probe/actions.ts', text)]]);

  test('a boolean flag and a hand-written failure literal are refused, a discriminated result passes', () => {
    for (const text of [
      'type R = { success: boolean; error?: string };',
      'type R = { ok: boolean; error?: string };',
      'type R = { success: false; error: string };',
      'type Run = () => Promise<{ success: boolean }>;',
      'function read<R extends { success: boolean }>(value: R): R { return value; }',
    ]) {
      expect(resultLiteralFindings('lib/probe.ts', text), text).toHaveLength(1);
    }
    for (const text of [
      'type R = { ok: true; data: string } | { ok: false };',
      'type Props = { sourceId: string; success: boolean };',
    ]) {
      expect(resultLiteralFindings('lib/probe.ts', text), text).toEqual([]);
    }
  });

  test('a sentence, a code with a glued payload and a template are refused as codes', () => {
    for (const error of [
      "'Aufträge konnten nicht geladen werden.'",
      "'stranded:time_approval'",
      '`started:${id}`',
    ]) {
      expect(
        failureCodeFindings('lib/probe.ts', `const r = { success: false, error: ${error} };`),
        error,
      ).toHaveLength(1);
    }
    expect(
      failureCodeFindings('lib/probe.ts', "const r = { success: false, error: 'load_failed' };"),
    ).toEqual([]);
    expect(failureCodeFindings('lib/probe.ts', 'const r = { success: false, error: code };')).toEqual([]);
  });

  test('an action outside the shape is refused, every built result passes', () => {
    expect(
      nonResultActions(
        planted(
          [
            "'use server';",
            'export async function a(): Promise<void> {}',
            'export async function b(): Promise<{ success: boolean }> { return { success: true }; }',
            'export async function c() { return 1; }',
            'type Loose = { ok: true } | { ok: false; error: string };',
            'export async function d(): Promise<Loose> { return { ok: true }; }',
            'export const e = async (): Promise<{ success: boolean }> => ({ success: true });',
            'export const f = async function () { return 1; };',
            'export const g: () => Promise<void> = async () => {};',
          ].join('\n'),
        ),
      ),
    ).toEqual([
      'lib/probe/actions.ts#a',
      'lib/probe/actions.ts#b',
      'lib/probe/actions.ts#c',
      'lib/probe/actions.ts#d',
      'lib/probe/actions.ts#e',
      'lib/probe/actions.ts#f',
      'lib/probe/actions.ts#g',
    ]);
    expect(
      nonResultActions(
        planted(
          [
            "'use server';",
            'type Saved = ActionResult<{ id: string }, "name_taken">;',
            'type Rich = Saved | (ActionFailure<"stale"> & { current: number });',
            'type Narrowed = (Extract<Saved, { success: true }> & { extra: string }) | ActionFailure;',
            'export async function a(): Promise<Saved> {}',
            'export async function b(): Promise<Rich> {}',
            'export async function c(): Promise<{ success: true; id: string } | ActionFailure> {}',
            'export async function d(): Promise<Narrowed> {}',
            'export async function e(): Promise<never> {}',
            'export const f = async (): Promise<Saved> => ({ success: true, id: "1" });',
            'export const g: () => Promise<Rich> = async () => ({ success: false, error: "stale", current: 1 });',
          ].join('\n'),
        ),
      ),
    ).toEqual([]);
  });
});
