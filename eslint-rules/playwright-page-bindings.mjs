// Which identifiers of a test file hold a Playwright `Page`: a parameter typed
// `Page`, a fixture whose name ends in "page", and what `newPage()` or a
// `page`/`popup` event returns. The rules that judge a lookup on the whole
// page share this one tracker.

function unwrapExpression(node) {
  if (!node) return node;
  if (node.type === 'AwaitExpression' || node.type === 'ChainExpression') {
    return unwrapExpression(node.argument ?? node.expression);
  }
  return node;
}

function callbackOf(node) {
  return node.arguments.find(
    (argument) => argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression',
  );
}

/**
 * Tracks the page bindings of one file. Merge `listeners` into the rule's
 * visitor, and call `recordTestFixturePages` first in its own `CallExpression`.
 */
export function createPageBindings() {
  const pageBindings = new Set();
  const pageTypeBindings = new Set(['Page']);
  const playwrightNamespaceBindings = new Set();

  function recordPlaywrightPageImports(node) {
    if (node.source.value !== '@playwright/test') return;
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') {
        playwrightNamespaceBindings.add(specifier.local.name);
        continue;
      }
      if (
        specifier.type === 'ImportSpecifier' &&
        specifier.imported.type === 'Identifier' &&
        specifier.imported.name === 'Page'
      ) {
        pageTypeBindings.add(specifier.local.name);
      }
    }
  }

  function isPageTypeAnnotation(annotation) {
    const typeNode = annotation?.type === 'TSTypeAnnotation' ? annotation.typeAnnotation : annotation;
    if (typeNode?.type !== 'TSTypeReference') return false;
    if (typeNode.typeName.type === 'Identifier') {
      return pageTypeBindings.has(typeNode.typeName.name);
    }
    return (
      typeNode.typeName.type === 'TSQualifiedName' &&
      typeNode.typeName.left.type === 'Identifier' &&
      playwrightNamespaceBindings.has(typeNode.typeName.left.name) &&
      typeNode.typeName.right.type === 'Identifier' &&
      typeNode.typeName.right.name === 'Page'
    );
  }

  function recordFunctionPageParameters(node) {
    for (const parameter of node.params) {
      const candidate = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
      if (candidate.type === 'Identifier' && isPageTypeAnnotation(candidate.typeAnnotation)) {
        pageBindings.add(candidate.name);
      }
    }
  }

  function recordTestFixturePages(node) {
    const fixture = callbackOf(node)?.params[0];
    if (fixture?.type !== 'ObjectPattern') return;
    for (const property of fixture.properties) {
      if (property.type !== 'Property' || property.value.type !== 'Identifier') continue;
      const fixtureName = property.key.type === 'Identifier' ? property.key.name : property.key.value;
      if (typeof fixtureName === 'string' && /page$/i.test(fixtureName)) {
        pageBindings.add(property.value.name);
      }
    }
  }

  function expressionReturnsPage(node) {
    const expression = unwrapExpression(node);
    if (expression?.type === 'Identifier') return pageBindings.has(expression.name);
    if (expression?.type !== 'CallExpression') return false;
    const callee = expression.callee;
    if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') {
      return false;
    }
    if (callee.property.name === 'newPage') return true;
    if (callee.property.name !== 'waitForEvent') return false;
    const eventName = expression.arguments[0];
    return eventName?.type === 'Literal' && /^(page|popup)$/.test(eventName.value);
  }

  function recordAssignment(left, right) {
    if (left.type === 'Identifier' && expressionReturnsPage(right)) {
      pageBindings.add(left.name);
    }
  }

  return {
    recordTestFixturePages,
    /** The lookup method's name when the call is `<page>.<method>(…)` on a tracked page, else null. */
    pageMethodOf(node) {
      const callee = node.callee;
      if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return null;
      if (callee.object.type !== 'Identifier' || !pageBindings.has(callee.object.name)) return null;
      return callee.property.name;
    },
    listeners: {
      ImportDeclaration: recordPlaywrightPageImports,
      ArrowFunctionExpression: recordFunctionPageParameters,
      FunctionDeclaration: recordFunctionPageParameters,
      FunctionExpression: recordFunctionPageParameters,
      VariableDeclarator(node) {
        if (node.init) recordAssignment(node.id, node.init);
      },
      AssignmentExpression(node) {
        recordAssignment(node.left, node.right);
      },
    },
  };
}
