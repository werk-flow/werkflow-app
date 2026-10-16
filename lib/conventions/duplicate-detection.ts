import ts from 'typescript';
import { parseProductSource } from './product-sources';

// The detection behind lib/conventions/duplicate-helpers.test.ts: module-level
// helpers and type declarations of a product file, each with the token forms
// that two copies share.

export type ModuleHelper = {
  name: string;
  file: string;
  /** Parameters and body, token for token. */
  body: string;
  /** The body with every identifier but a member name replaced by one placeholder. */
  erasedBody: string;
  tokenCount: number;
};

export type ModuleType = {
  name: string;
  file: string;
  exported: boolean;
  /** Type parameters, heritage and members (or the aliased type), token for token. */
  body: string;
  tokenCount: number;
};

const ERASED_IDENTIFIER = '$';

/**
 * The node's tokens without comments and whitespace. With `erase`, every
 * identifier becomes one placeholder except a member name after `.` or `?.`:
 * a copy that renamed its parameters, locals or the data it reads stays equal,
 * while two mappers over different fields (`row.name`, `row.date`) do not.
 */
function nodeTokens(node: ts.Node, source: ts.SourceFile, erase: boolean): string[] {
  return rangeTokens(node.getStart(source), node.getEnd(), source, erase);
}

function rangeTokens(start: number, end: number, source: ts.SourceFile, erase: boolean): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    source.languageVariant,
    source.text.slice(start, end),
  );
  const tokens: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const previous = tokens.at(-1);
    const memberName = previous === '.' || previous === '?.';
    tokens.push(
      erase && kind === ts.SyntaxKind.Identifier && !memberName ? ERASED_IDENTIFIER : scanner.getTokenText(),
    );
  }
  return tokens;
}

function helperOf(
  name: string,
  file: string,
  node: ts.FunctionLikeDeclaration,
  source: ts.SourceFile,
): ModuleHelper {
  // The parameters and the body; the name and modifiers may differ between copies.
  const parts = [...node.parameters, ...(node.body ? [node.body] : [])];
  const tokens = parts.flatMap((part) => nodeTokens(part, source, false));
  const erased = parts.flatMap((part) => nodeTokens(part, source, true));
  return { name, file, body: tokens.join(' '), erasedBody: erased.join(' '), tokenCount: tokens.length };
}

/** Module-level function declarations and arrow or function expressions bound to a const. */
export function moduleHelpers(file: string, text?: string): ModuleHelper[] {
  const source = parseProductSource(file, text);
  const helpers: ModuleHelper[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      helpers.push(helperOf(statement.name.text, file, statement, source));
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        helpers.push(helperOf(declaration.name.text, file, initializer, source));
      }
    }
  }
  return helpers;
}

/** Local names a module exports through a separate `export { a, type B }` statement (no `from`). */
export function separatelyExportedNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier) continue;
    const clause = statement.exportClause;
    if (!clause || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) names.add((element.propertyName ?? element.name).text);
  }
  return names;
}

/** Module-level type aliases and interfaces. */
export function moduleTypes(file: string, text?: string): ModuleType[] {
  const source = parseProductSource(file, text);
  const exportedLater = separatelyExportedNames(source);
  return source.statements.flatMap((statement) => {
    if (!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) return [];
    const head = [
      ...(statement.typeParameters ?? []),
      ...(ts.isInterfaceDeclaration(statement) ? (statement.heritageClauses ?? []) : []),
    ];
    // An interface body from its opening brace, so it compares with an aliased type literal.
    const shape = ts.isTypeAliasDeclaration(statement)
      ? nodeTokens(statement.type, source, false)
      : rangeTokens(statement.members.pos - 1, statement.getEnd(), source, false);
    const tokens = [...head.flatMap((part) => nodeTokens(part, source, false)), ...shape];
    const exported =
      (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0 ||
      exportedLater.has(statement.name.text);
    return [{ name: statement.name.text, file, exported, body: tokens.join(' '), tokenCount: tokens.length }];
  });
}

/** Groups of two or more declarations under different names that share a key. */
export function renamedCopies<Declaration extends { name: string; file: string }>(
  declarations: readonly Declaration[],
  key: (declaration: Declaration) => string | undefined,
): Map<string, Declaration[]> {
  const byKey = new Map<string, Declaration[]>();
  for (const declaration of declarations) {
    const value = key(declaration);
    if (value !== undefined) byKey.set(value, [...(byKey.get(value) ?? []), declaration]);
  }
  const copies = new Map<string, Declaration[]>();
  for (const group of byKey.values()) {
    const names = [...new Set(group.map((declaration) => declaration.name))].sort();
    if (names.length > 1) copies.set(names.join(' = '), group);
  }
  return copies;
}

/** Names declared in more than one file, with the files. */
export function sharedNames(declarations: readonly { name: string; file: string }[]): Map<string, string[]> {
  const filesByName = new Map<string, string[]>();
  for (const { name, file } of declarations) {
    const files = filesByName.get(name) ?? [];
    if (!files.includes(file)) filesByName.set(name, [...files, file]);
  }
  return new Map([...filesByName].filter(([, files]) => files.length > 1));
}
