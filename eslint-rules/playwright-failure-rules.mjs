// Failure rule of the browser-test support modules (docs/technical/testing.md,
// Never: "retry until green"). A support module acts for every spec that calls
// it, so a failure it swallows vanishes from all of them at once.

/** The reviewed reason form that quality/no-silent-catch accepts in product code. */
const BEST_EFFORT_ANNOTATION = /^\s*best-effort: \S/;

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/** `false`, `null`, `'x'`, `undefined`, `void 0`, `[]` or `{}`: a value that says nothing about the failure. */
function isConstant(node) {
  if (node.type === 'Literal') return true;
  if (node.type === 'Identifier') return node.name === 'undefined';
  if (node.type === 'UnaryExpression') return node.operator === 'void';
  if (node.type === 'ArrayExpression') return node.elements.length === 0;
  if (node.type === 'ObjectExpression') return node.properties.length === 0;
  return false;
}

/** An empty block, or one that only returns nothing or a constant. */
function blockSwallows(block) {
  if (block.body.length === 0) return true;
  const [only] = block.body;
  return (
    block.body.length === 1 &&
    only.type === 'ReturnStatement' &&
    (!only.argument || isConstant(only.argument))
  );
}

/** `() => false`, `() => undefined`, `() => {}`, `() => { return null; }` and the like. */
function handlerSwallows(handler) {
  if (!handler || !FUNCTION_TYPES.has(handler.type)) return false;
  return handler.body.type === 'BlockStatement' ? blockSwallows(handler.body) : isConstant(handler.body);
}

function isAnnotation(comment) {
  return BEST_EFFORT_ANNOTATION.test(comment.value);
}

/** The statement that holds a node: an `if`, a declaration, an expression statement. */
function enclosingStatement(node) {
  let current = node;
  while (current.parent && !/(?:Statement|Declaration)$/.test(current.type)) current = current.parent;
  return current;
}

/**
 * A support module never turns a failure into a constant. A `.catch` (or the
 * rejection handler of a `.then`) that yields nothing or a constant, and a
 * `catch` block that is empty or
 * only returns nothing or a constant, hide a strict-mode violation, a closed
 * page or a missed state behind a quiet branch, in every spec that calls the
 * helper. Let the failure propagate, wait for the exact fact first, branch on
 * a timed-out wait through `settledBeforeTimeout`
 * (tests/golden/support/steps/interaction.ts), which lets every other failure
 * through, or name a genuine best effort (a teardown cleanup, a click whose
 * outcome the next line asserts) with a `// best-effort: <reason>` comment:
 * above the statement or inside the handler of a `.catch`, inside the block
 * of a `catch`. The spec files keep playwright-spec/no-retried-action, which
 * accepts no reason.
 */
export const noSwallowedFailureRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      swallowedCatch:
        'This rejection handler turns a failure into a constant, so a strict-mode violation, a closed page or a missed state passes as a quiet branch in every spec that calls the helper. Let the call fail, wait for the exact fact first, or branch on a timed-out wait through settledBeforeTimeout (tests/golden/support/steps/interaction.ts). For a genuine best effort, write `// best-effort: <reason>` above the statement.',
      swallowedClause:
        'This catch turns a failure into a constant, so the caller cannot tell a failure from a result. Rethrow, return a failure the caller handles, or test the precondition instead. For a genuine best effort, write `// best-effort: <reason>` inside the block.',
    },
  },
  create(context) {
    const { sourceCode } = context;

    function catchCallAnnotated(node, handler) {
      const statement = enclosingStatement(node);
      return [...sourceCode.getCommentsBefore(statement), ...sourceCode.getCommentsInside(handler)].some(
        isAnnotation,
      );
    }

    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier')
          return;
        const name = callee.property.name;
        if (name !== 'catch' && name !== 'then') return;
        const handler = node.arguments[name === 'catch' ? 0 : 1];
        if (!handlerSwallows(handler) || catchCallAnnotated(node, handler)) return;
        context.report({ node, messageId: 'swallowedCatch' });
      },
      CatchClause(node) {
        if (!blockSwallows(node.body)) return;
        if (sourceCode.getCommentsInside(node.body).some(isAnnotation)) return;
        context.report({ node, messageId: 'swallowedClause' });
      },
    };
  },
};
