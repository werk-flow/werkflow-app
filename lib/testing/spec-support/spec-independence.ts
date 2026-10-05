import ts from 'typescript';

/**
 * Static checks that keep every browser test independent (testing.md, "Spec checklist"):
 * a test never consumes another test's output, a module never holds state that one test
 * writes and another reads, and no date comes from the wall clock while the module loads.
 */

const CHAIN_HELPERS = new Set([
  'requireChainedValue',
  'requireChainedPrecondition',
  'requireVisiblePrecondition',
  'saveCheckpoint',
  'checkpointValue',
  'saveAuditCheckpoint',
  'auditCheckpoint',
]);

const MUTATING_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'set',
  'add',
  'delete',
  'clear',
]);

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function insideFunction(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) if (isFunctionLike(current)) return true;
  return false;
}

/** `new Date()` without arguments or `Date.now()`: both read the wall clock. */
function readsWallClock(node: ts.Node): boolean {
  if (ts.isNewExpression(node))
    return ts.isIdentifier(node.expression) && node.expression.text === 'Date' && !node.arguments?.length;
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Date' &&
    node.expression.name.text === 'now'
  );
}

/** The identifier a mutation targets, for `name.push(...)`, `name[key] = ...` and `name.field = ...`. */
function rootIdentifier(expression: ts.Expression): string | undefined {
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
    current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
}

export function specIndependenceProblems(source: string, file: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  const moduleConstants = new Set<string>();
  const line = (node: ts.Node): number => parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const mutable = !(statement.declarationList.flags & ts.NodeFlags.Const);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (mutable)
        problems.push(
          `${file}:${line(declaration)}: module-level \`let\`/\`var\` ${declaration.name.text} can carry state from one test to the next`,
        );
      else moduleConstants.add(declaration.name.text);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      const type = node.properties
        .filter(ts.isPropertyAssignment)
        .find((property) => property.name.getText(parsed).replaceAll(/["']/g, '') === 'type')?.initializer;
      if (type && ts.isStringLiteralLike(type) && /^requires-(test|file)$/.test(type.text))
        problems.push(`${file}:${line(node)}: \`${type.text}\` makes one test depend on another`);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      CHAIN_HELPERS.has(node.expression.text)
    )
      problems.push(
        `${file}:${line(node)}: \`${node.expression.text}\` hands a value from one test to another; seed the precondition in the test instead`,
      );
    if (readsWallClock(node) && !insideFunction(node))
      problems.push(
        `${file}:${line(node)}: the wall clock is read while the module loads; take the date from the businessDate fixture inside the test`,
      );
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MUTATING_METHODS.has(node.expression.name.text)
    ) {
      const root = rootIdentifier(node.expression.expression);
      if (root && moduleConstants.has(root) && insideFunction(node) && !shadowed(node, root))
        problems.push(
          `${file}:${line(node)}: module-level ${root} is mutated inside a test or helper; keep per-test state inside the test`,
        );
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
    ) {
      const root = rootIdentifier(node.left);
      if (root && moduleConstants.has(root) && insideFunction(node) && !shadowed(node, root))
        problems.push(
          `${file}:${line(node)}: module-level ${root} is assigned inside a test or helper; keep per-test state inside the test`,
        );
    }
    ts.forEachChild(node, visit);
  }

  /** True when a parameter or local declaration between the node and the module scope reuses the name. */
  function shadowed(node: ts.Node, name: string): boolean {
    for (let current = node.parent; current && current !== parsed; current = current.parent) {
      if (isFunctionLike(current)) {
        const parameters = (current as ts.SignatureDeclaration).parameters;
        if (parameters.some((parameter) => declaresName(parameter.name, name))) return true;
      }
      if (ts.isBlock(current) || ts.isSourceFile(current)) {
        for (const statement of current.statements)
          if (
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some((declaration) => declaresName(declaration.name, name))
          )
            return true;
      }
    }
    return false;
  }

  visit(parsed);
  return problems;
}

function declaresName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && declaresName(element.name, name),
  );
}
