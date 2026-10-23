import { posix } from 'node:path';
import ts from 'typescript';
import { resolveSpecifier } from './action-prechecks-scan';

// The pure scanner behind lib/security/boundary-coverage.test.ts. It reads
// source texts only, so the test can plant a defect without touching the tree.

export type SourceFile = { readonly path: string; readonly text: string };
export type ActionModule = { readonly path: string; readonly actions: readonly string[] };
/** Reads a repository file by its path, or `null` when it does not exist. */
export type ReadSource = (path: string) => string | null;

const REFUSAL = /'(not_authorized|not_a_member|no_active_org)'|_not_found'/;
const BOUNDARY_NAME = /boundar|authorization|access/;
/** A parameter or property that carries a row, member or organization id. */
const ID_NAME = /(?:^ids?|Ids?)(?:[A-Z_]|$)|_ids?(?:_|$)/;
/** Keywords that admit any value, so a type that contains one cannot be proven free of ids. */
const OPEN_KEYWORDS = new Set([
  ts.SyntaxKind.AnyKeyword,
  ts.SyntaxKind.UnknownKeyword,
  ts.SyntaxKind.ObjectKeyword,
]);
const PROVABLE_KEYWORDS = new Set([
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.LiteralType,
]);
/** The zod helpers whose `typeof schema` argument is the whole data: `z.infer<typeof schema>`. */
const ZOD_INFERENCE = new Set(['z.infer', 'z.input', 'z.output']);
/** The files a repository specifier may name, in the order the bundler tries them. */
const MODULE_CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
/** How many declarations a proof follows from a parameter before it gives up. */
const MAX_TYPE_DEPTH = 8;
/** Built-in generics whose type arguments are the data: `Partial<Input>`, `Omit<Input, 'key'>`. */
const TRANSPARENT_GENERICS = new Set([
  'Partial',
  'Required',
  'Readonly',
  'ReadonlyArray',
  'Array',
  'Omit',
  'Pick',
  'NonNullable',
  'Record',
]);

function parse(file: SourceFile): ts.SourceFile {
  return ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function hasModuleDirective(text: string): boolean {
  return /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use server['"]/.test(text);
}

function isExportedFunction(node: ts.FunctionDeclaration): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/** The 'use server' modules and the names of their exported actions. */
export function actionModules(files: readonly SourceFile[]): ActionModule[] {
  return files
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file.path) && hasModuleDirective(file.text))
    .map((file) => ({
      path: file.path,
      actions: exportedNames(parse(file)),
    }));
}

/**
 * Every name a module exports as a value: `export function`, `export const`
 * and `export { name }`. Next.js treats each as a Server Action of a
 * 'use server' module, so each needs its boundary fixture.
 */
function exportedNames(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) => {
    if (ts.isFunctionDeclaration(statement) && isExportedFunction(statement))
      return statement.name ? [statement.name.text] : [];
    if (ts.isVariableStatement(statement) && hasExportModifier(statement))
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
      );
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
      return statement.exportClause.elements
        .filter((element) => !element.isTypeOnly)
        .map((element) => element.name.text);
    return [];
  });
}

function hasExportModifier(node: ts.VariableStatement): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/** Repository paths (without extension) that a file imports, statically or dynamically. */
function importedModules(file: SourceFile): Set<string> {
  const modules = new Set<string>();
  for (const match of file.text.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)) {
    const modulePath = resolveSpecifier(file.path, match[1] ?? '');
    if (modulePath) modules.add(modulePath.replace(/\.tsx?$/, ''));
  }
  return modules;
}

/** A boundary file: it builds on the action world or is named as a check, asserts a refusal, and a test runs it. */
function isBoundaryFile(file: SourceFile, runnerText: string): boolean {
  const base = posix.basename(file.path).replace(/\.tsx?$/, '');
  const isTest = /\.test\.tsx?$/.test(file.path);
  const marked = BOUNDARY_NAME.test(base) || file.text.includes('action-boundary-world');
  return marked && REFUSAL.test(file.text) && (isTest || runnerText.includes(base));
}

/**
 * The covered actions as `module#action`, each with the boundary files that
 * cover it: a file imports the module, names the action beyond the import
 * (a call or a reference) and asserts a refusal.
 */
export function boundaryCoverage(
  modules: readonly ActionModule[],
  candidates: readonly SourceFile[],
  runnerText: string,
): Map<string, string[]> {
  const boundaries = candidates.filter((file) => isBoundaryFile(file, runnerText));
  const coverage = new Map<string, string[]>();
  for (const actionModule of modules) {
    const modulePath = actionModule.path.replace(/\.tsx?$/, '');
    const importing = boundaries.filter((file) => importedModules(file).has(modulePath));
    for (const action of actionModule.actions) {
      const pattern = new RegExp(`\\b${action}\\b`, 'g');
      const covering = importing.filter((file) => (file.text.match(pattern) ?? []).length >= 2);
      if (covering.length > 0) {
        coverage.set(
          `${actionModule.path}#${action}`,
          covering.map((file) => file.path),
        );
      }
    }
  }
  return coverage;
}

type TypeScope = { readonly source: ts.SourceFile; readonly read: ReadSource; readonly depth: number };

function localDeclaration(source: ts.SourceFile, name: string): ts.Node | undefined {
  for (const statement of source.statements) {
    const named =
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isFunctionDeclaration(statement);
    if (named && statement.name?.text === name) return statement;
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
      );
      if (declaration) return declaration;
    }
  }
  return undefined;
}

/** The declaration of `name` in its file or in the repository module it is imported from. */
function declarationOf(name: string, scope: TypeScope): { node: ts.Node; source: ts.SourceFile } | null {
  const local = localDeclaration(scope.source, name);
  if (local) return { node: local, source: scope.source };
  for (const statement of scope.source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const element = bindings.elements.find((candidate) => candidate.name.text === name);
    const modulePath = resolveSpecifier(scope.source.fileName, statement.moduleSpecifier.text);
    if (!element || !modulePath) continue;
    const base = modulePath.replace(/\.tsx?$/, '');
    const path = MODULE_CANDIDATES.map((suffix) => `${base}${suffix}`).find(
      (candidate) => scope.read(candidate) !== null,
    );
    const text = path === undefined ? null : scope.read(path);
    if (path === undefined || text === null) return null;
    const source = parse({ path, text });
    const imported = localDeclaration(source, (element.propertyName ?? element.name).text);
    return imported ? { node: imported, source } : null;
  }
  return null;
}

/** Problems that keep a type from being proven free of ids. */
function typeProblems(node: ts.Node, scope: TypeScope): string[] {
  if (scope.depth > MAX_TYPE_DEPTH) return [`${node.getText(scope.source)} nests too deep to prove`];
  // A generated enum carries labels, never ids.
  if (ts.isIndexedAccessTypeNode(node) && /^Database\[[^\]]+\]\['Enums'\]/.test(node.getText(scope.source)))
    return [];
  // A function is a refinement or transform callback, not a field of the input.
  if (
    PROVABLE_KEYWORDS.has(node.kind) ||
    ts.isStringLiteralLike(node) ||
    ts.isTemplateExpression(node) ||
    ts.isNumericLiteral(node) ||
    ts.isFunctionLike(node)
  )
    return [];
  if (ts.isIdentifier(node)) return identifierProblems(node, scope);
  if (ts.isPropertyAccessExpression(node)) {
    // `z.string().uuid()` and `z.uuid()` parse an id under any property name.
    if (/uuid/i.test(node.name.text)) return [`${node.getText(scope.source)} parses an id`];
    return typeProblems(node.expression, scope);
  }
  if (ts.isPropertySignature(node) || ts.isPropertyAssignment(node)) {
    const name = node.name.getText(scope.source).replace(/^['"]|['"]$/g, '');
    if (ID_NAME.test(name)) return [`property ${name} is an id`];
    const value = ts.isPropertySignature(node) ? node.type : node.initializer;
    return value ? typeProblems(value, scope) : [`property ${name} has no type`];
  }
  if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node) || ts.isTypeQueryNode(node)) {
    return typeReferenceProblems(node, scope);
  }
  if (ts.isVariableDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    const value = ts.isVariableDeclaration(node) ? node.initializer : node.type;
    return value ? typeProblems(value, scope) : [`${node.name.getText(scope.source)} has no value`];
  }
  if (
    ts.isTypeLiteralNode(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isUnionTypeNode(node) ||
    ts.isArrayTypeNode(node) ||
    ts.isParenthesizedTypeNode(node) ||
    ts.isCallExpression(node) ||
    ts.isObjectLiteralExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isIntersectionTypeNode(node) ||
    ts.isIndexedAccessTypeNode(node) ||
    ts.isTypeOperatorNode(node)
  ) {
    return node.getChildren(scope.source).flatMap((child) => childProblems(child, scope));
  }
  return [`${node.getText(scope.source)} cannot be proven free of ids`];
}

/** Children of a composite node: punctuation and method signatures carry no data. */
function childProblems(child: ts.Node, scope: TypeScope): string[] {
  if (child.kind === ts.SyntaxKind.SyntaxList) {
    return child.getChildren(scope.source).flatMap((item) => childProblems(item, scope));
  }
  // An interface's or type's own name and its type parameters name no data.
  if (
    ts.isIdentifier(child) &&
    (ts.isInterfaceDeclaration(child.parent) || ts.isTypeAliasDeclaration(child.parent))
  )
    return [];
  if (OPEN_KEYWORDS.has(child.kind)) return [`${child.getText(scope.source)} cannot be proven free of ids`];
  if (ts.isMethodSignature(child) || (ts.isToken(child) && !ts.isIdentifier(child))) return [];
  return typeProblems(child, scope);
}

/**
 * A schema or value named by an identifier: the zod namespace carries no
 * data, a repository declaration is followed, anything else is unprovable.
 */
function identifierProblems(node: ts.Identifier, scope: TypeScope): string[] {
  if (node.text === 'z') return [];
  if (/uuid/i.test(node.text)) return [`${node.text} parses an id`];
  const found = declarationOf(node.text, scope);
  if (!found) return [`${node.text} cannot be resolved inside the repository`];
  // A function passed as a refinement or transform holds no field; a function
  // called to build the value holds what it returns, which this proof cannot read.
  const builds = ts.isCallExpression(node.parent) && node.parent.expression === node;
  if (builds && isFunctionDeclarationLike(found.node))
    return [`${node.text}() builds the value and cannot be proven free of ids`];
  return typeProblems(found.node, { ...scope, source: found.source, depth: scope.depth + 1 });
}

/** A function declaration, or a variable bound to an arrow or function expression. */
function isFunctionDeclarationLike(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) return true;
  return (
    ts.isVariableDeclaration(node) &&
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  );
}

/** `Name`, `z.infer<typeof schema>` or `typeof schema`: follow the name to its declaration. */
function typeReferenceProblems(
  node: ts.TypeReferenceNode | ts.ExpressionWithTypeArguments | ts.TypeQueryNode,
  scope: TypeScope,
): string[] {
  const argument = ts.isTypeQueryNode(node) ? undefined : node.typeArguments?.[0];
  const generic = ts.isTypeQueryNode(node)
    ? ''
    : ts.isTypeReferenceNode(node)
      ? node.typeName.getText(scope.source)
      : '';
  if (argument && ts.isTypeQueryNode(argument) && ZOD_INFERENCE.has(generic))
    return typeProblems(argument, scope);
  const nameNode = ts.isTypeReferenceNode(node)
    ? node.typeName
    : ts.isTypeQueryNode(node)
      ? node.exprName
      : node.expression;
  const name = nameNode.getText(scope.source);
  // `as const` narrows a literal; it names no type.
  if (name === 'const') return [];
  if (TRANSPARENT_GENERICS.has(name) && !ts.isTypeQueryNode(node)) {
    return (node.typeArguments ?? []).flatMap((typeArgument) => typeProblems(typeArgument, scope));
  }
  if (name.includes('.')) return [`${name} cannot be proven free of ids`];
  const found = declarationOf(name, scope);
  if (!found) return [`${name} cannot be resolved inside the repository`];
  return typeProblems(found.node, { ...scope, source: found.source, depth: scope.depth + 1 });
}

/**
 * Why an exported action may take an id: each parameter's name, and every
 * property of its declared type or schema, followed through repository
 * modules. An empty list proves the action takes no id argument.
 */
export function idArgumentProblems(file: SourceFile, action: string, read: ReadSource): string[] {
  const source = parse(file);
  const declaration = source.statements
    .filter(ts.isFunctionDeclaration)
    .find((node) => node.name?.text === action && isExportedFunction(node));
  if (!declaration) return [`${action} is not an exported function of ${file.path}`];
  return declaration.parameters.flatMap((parameter) => {
    const name = parameter.name.getText(source);
    if (!ts.isIdentifier(parameter.name)) return [`parameter ${name} is destructured`];
    if (ID_NAME.test(name)) return [`parameter ${name} is an id`];
    if (!parameter.type) return [`parameter ${name} has no declared type`];
    return typeProblems(parameter.type, { source, read, depth: 0 });
  });
}
