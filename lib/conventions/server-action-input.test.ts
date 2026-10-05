import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for input validation at the Server Action boundary (AGENTS.md
// "3. Security": never trust an id, an organization or a role that the client
// sent). Every export of a 'use server' module is a public POST endpoint whose
// arguments arrive from the network with the declared TypeScript types
// unchecked. Each exported function therefore takes no parameter, or every
// parameter's first use sits inside the arguments of
//   1. a `.parse(` or `.safeParse(` call (a zod schema), or
//   2. a named validator: a function called `parse…` or `validate…`, or `isUuid`.
// A parameter that is never used passes; destructuring in the signature is a
// use before validation. REVIEWED_INPUTS holds the reasoned exceptions; an
// entry that matches no parameter fails, so the list only describes the code.

/** "file#function#parameter" -> why the raw argument is safe without a schema. */
const REVIEWED_INPUTS: Readonly<Record<string, string>> = {};

const VALIDATOR_NAME = /^(parse|validate)[A-Z]\w*$|^isUuid$/;

function hasServerDirective(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

type ExportedFunction = { name: string; node: ts.SignatureDeclaration & { body?: ts.Node | undefined } };

function exportedFunctions(source: ts.SourceFile): ExportedFunction[] {
  if (!hasServerDirective(source.statements)) return [];
  const functions: ExportedFunction[] = [];
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      functions.push({ name: statement.name?.text ?? 'default', node: statement });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          functions.push({ name: declaration.name.getText(source), node: initializer });
        }
      }
    }
  }
  return functions;
}

/** True when `node` sits inside the arguments of a schema parse or a named validator call. */
function isInsideValidation(node: ts.Node, boundary: ts.Node): boolean {
  for (
    let child: ts.Node = node, current = node.parent;
    current && current !== boundary;
    child = current, current = current.parent
  ) {
    if (!ts.isCallExpression(current) || current.expression === child) continue;
    if (!current.arguments.some((argument) => argument === child)) continue;
    const callee = current.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      (callee.name.text === 'parse' || callee.name.text === 'safeParse')
    ) {
      return true;
    }
    if (ts.isIdentifier(callee) && VALIDATOR_NAME.test(callee.text)) return true;
  }
  return false;
}

function firstUse(body: ts.Node, name: string): ts.Identifier | undefined {
  let found: ts.Identifier | undefined;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isPropertyName) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return found;
}

/**
 * `schema.parse(input.draft)` validates one field and leaves the rest of
 * `input` raw. Reading a form field (`formData.get('id')`) inside the parse is
 * the one accepted property access.
 */
function parsesOnlyAPart(use: ts.Identifier): boolean {
  const parent = use.parent;
  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== use) {
    return ts.isElementAccessExpression(parent) && parent.expression === use;
  }
  return !FORM_FIELD_READS.has(parent.name.text);
}

const FORM_FIELD_READS = new Set(['get', 'getAll']);

function unvalidatedParameters(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  for (const { name, node } of exportedFunctions(source)) {
    node.parameters.forEach((parameter, index) => {
      if (!ts.isIdentifier(parameter.name)) {
        problems.push(
          `${file}#${name}#${index}: destructured in the signature; take one argument and parse it`,
        );
        return;
      }
      const parameterName = parameter.name.text;
      const use = node.body ? firstUse(node.body, parameterName) : undefined;
      if (!use || (isInsideValidation(use, node) && !parsesOnlyAPart(use))) return;
      problems.push(`${file}#${name}#${parameterName}`);
    });
  }
  return problems;
}

test('every Server Action parses its arguments before their first use', () => {
  const problems: string[] = [];
  for (const file of listProductSources(['lib', 'app'])) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    if (!text.includes('use server')) continue;
    problems.push(...unvalidatedParameters(file, text));
  }
  const unreviewed = problems.filter((problem) => REVIEWED_INPUTS[problem] === undefined);
  expect(
    unreviewed,
    "Parse each argument with a zod schema (ids with uuidSchema, enums from Constants, bounded strings) before using it, and return the module's invalid_input failure on a parse error.",
  ).toEqual([]);
  const stale = Object.keys(REVIEWED_INPUTS).filter((key) => !problems.includes(key));
  expect(stale, 'These REVIEWED_INPUTS entries match no parameter; remove them.').toEqual([]);
}, 60_000);

function fixture(code: string): string[] {
  return unvalidatedParameters('lib/fixture.ts', `'use server';\n${code}`);
}

test('the scan accepts schema parses and named validators and rejects raw use', () => {
  expect(fixture(`export async function save(id: string) { await remove(id); }`)).toEqual([
    'lib/fixture.ts#save#id',
  ]);
  expect(
    fixture(
      `export async function save(id: string) { const parsed = schema.safeParse(id); if (!parsed.success) return; }`,
    ),
  ).toEqual([]);
  expect(
    fixture(
      `export async function save(formData: FormData) { const parsed = schema.safeParse({ id: formData.get('id') }); }`,
    ),
  ).toEqual([]);
  expect(
    fixture(`export async function save(input: Input) { const value = parseSaveInput(input); }`),
  ).toEqual([]);
  expect(
    fixture(`export async function save(id: string) { if (!isUuid(id)) return; await remove(id); }`),
  ).toEqual([]);
  expect(
    fixture(
      `export async function save(_previous: State, formData: FormData) { return schema.parse(formData); }`,
    ),
  ).toEqual([]);
  expect(fixture(`export async function save({ id }: { id: string }) { await remove(id); }`)).toHaveLength(1);
  expect(fixture(`export async function load() { return read(); }`)).toEqual([]);
  expect(
    fixture(
      `export async function save(input: Input) { const draft = schema.parse(input.draft); await remove(input.id); }`,
    ),
  ).toEqual(['lib/fixture.ts#save#input']);
  expect(
    fixture(
      `export const save = async (input: Input) => { await log(input.id); return schema.parse(input); };`,
    ),
  ).toEqual(['lib/fixture.ts#save#input']);
});
