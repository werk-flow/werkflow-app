import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { repositoryRoot } from './product-sources';

// The query-builder walk that the convention scans share: which calls a
// `.from(...)` chain receives, including a builder variable continued later in
// the same function, and which tables carry `organization_id`.

export type ChainCall = { method: string; call: ts.CallExpression };

export function stringValue(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

/** Unwraps `(x)`, `x as T`, `x satisfies T`, `await x` and `x!`. */
export function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return undefined;
}

/** The variable initializer that `name` refers to inside `scope`, when it is a const or let binding. */
export function bindingInitializer(scope: ts.Node, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  ts.forEachChild(scope, function visit(node) {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

/** Calls applied to the builder that `start` begins, outermost last, and the expression the chain ends in. */
export function chainCalls(start: ts.Expression): { calls: ChainCall[]; top: ts.Expression } {
  const calls: ChainCall[] = [];
  let current: ts.Expression = start;
  for (;;) {
    const parent = current.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      const call = parent.parent;
      if (call && ts.isCallExpression(call) && call.expression === parent) {
        calls.push({ method: parent.name.text, call });
        current = call;
        continue;
      }
    }
    if (
      parent &&
      (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent))
    ) {
      current = parent;
      continue;
    }
    return { calls, top: current };
  }
}

/** The identifier a chain's end is bound to: `let query = …` or `query = …`. */
export function boundName(top: ts.Expression): string | undefined {
  const parent = top.parent;
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === top &&
    ts.isIdentifier(parent.name)
  )
    return parent.name.text;
  if (
    parent &&
    ts.isBinaryExpression(parent) &&
    parent.right === top &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(parent.left)
  )
    return parent.left.text;
  return undefined;
}

/** Builder variables continued after the chain: `let query = admin.from(…)…; query = query.eq(…)`. */
export function continuationCalls(top: ts.Expression): ChainCall[] {
  const name = boundName(top);
  if (!name) return [];
  const scope = enclosingFunction(top) ?? top.getSourceFile();
  const calls: ChainCall[] = [];
  ts.forEachChild(scope, function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name &&
      node.parent &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
    ) {
      calls.push({ method: node.name.text, call: node.parent });
      calls.push(...chainCalls(node.parent).calls);
    }
    ts.forEachChild(node, visit);
  });
  return calls;
}

/** Tables and views of the public schema whose rows carry `organization_id`. */
export function organizationTables(): Set<string> {
  const file = 'lib/supabase/database.types.ts';
  const source = ts.createSourceFile(
    file,
    readFileSync(resolve(repositoryRoot, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const memberName = (member: ts.TypeElement): string =>
    member.name?.getText(source).replace(/['"]/g, '') ?? '';
  const memberType = (
    members: ts.NodeArray<ts.TypeElement>,
    name: string,
  ): ts.TypeLiteralNode | undefined => {
    for (const member of members) {
      if (
        ts.isPropertySignature(member) &&
        memberName(member) === name &&
        member.type &&
        ts.isTypeLiteralNode(member.type)
      ) {
        return member.type;
      }
    }
    return undefined;
  };
  const tables = new Set<string>();
  ts.forEachChild(source, function visit(node) {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'Database' && ts.isTypeLiteralNode(node.type)) {
      const publicSchema = memberType(node.type.members, 'public');
      if (!publicSchema) return;
      for (const group of ['Tables', 'Views']) {
        const relations = memberType(publicSchema.members, group);
        for (const relation of relations?.members ?? []) {
          if (!ts.isPropertySignature(relation) || !relation.type || !ts.isTypeLiteralNode(relation.type))
            continue;
          const row = memberType(relation.type.members, 'Row');
          if (
            row?.members.some(
              (member) => ts.isPropertySignature(member) && memberName(member) === 'organization_id',
            )
          )
            tables.add(memberName(relation));
        }
      }
    }
    ts.forEachChild(node, visit);
  });
  return tables;
}
