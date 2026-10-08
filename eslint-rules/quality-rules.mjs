// Code-quality lint rules (docs/technical/code-quality.md). Each rule names
// the defect that motivated it so the why travels with the no (decision 0005).

const BEST_EFFORT_ANNOTATION = /^\s*best-effort: \S/;
const EMPTY_VALUE_TYPES = new Set(['ArrayExpression', 'ObjectExpression']);

function isLoggingCall(expression) {
  if (expression?.type === 'AwaitExpression') return isLoggingCall(expression.argument);
  if (expression?.type !== 'CallExpression') return false;
  const { callee } = expression;
  if (callee.type === 'Identifier') return /^log[A-Z]/.test(callee.name);
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'console'
  );
}

function isEmptyValue(argument) {
  if (argument === null) return true;
  if (argument.type === 'Identifier') return argument.name === 'undefined';
  if (argument.type === 'UnaryExpression') return argument.operator === 'void';
  if (EMPTY_VALUE_TYPES.has(argument.type)) {
    return (argument.elements ?? argument.properties).length === 0;
  }
  return false;
}

/** A statement that neither surfaces the failure nor does other work. */
function isSilentStatement(statement) {
  switch (statement.type) {
    case 'EmptyStatement':
    case 'ContinueStatement':
    case 'BreakStatement':
      return true;
    case 'ExpressionStatement':
      return isLoggingCall(statement.expression);
    case 'ReturnStatement':
      return isEmptyValue(statement.argument);
    case 'BlockStatement':
      return statement.body.every(isSilentStatement);
    default:
      return false;
  }
}

/**
 * A `catch` whose block is empty, only logs, or only returns nothing, an empty
 * array or an empty object hides a failure the user or the caller needs: the
 * surface then shows an empty or stale state as the truth. The sign-out
 * cleanup in hooks/use-sign-out.ts was the known case: a failed clock-out
 * vanished and the working time kept running. A parser's `return null` or
 * `return false` is its typed "invalid" result, which the caller handles, so
 * it counts as surfaced. Surface the failure
 * (return an ActionFailure, rethrow, set visible error state), or mark a
 * genuine best effort with a `// best-effort: <reason>` comment inside the
 * block, so the decision is greppable and reviewed.
 */
const noSilentCatchRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      silent:
        'This catch only logs or drops the failure, so neither the user nor the caller learns of it. Return a failure, rethrow, or set visible error state. For a genuine best effort (cleanup after the main outcome, a non-essential hint), write `// best-effort: <why the failure may vanish>` inside the block (docs/technical/code-quality.md).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CatchClause(node) {
        if (!node.body.body.every(isSilentStatement)) return;
        const annotated = sourceCode
          .getCommentsInside(node.body)
          .some((comment) => BEST_EFFORT_ANNOTATION.test(comment.value));
        if (annotated) return;
        context.report({ node, messageId: 'silent' });
      },
    };
  },
};

export const qualityRules = {
  rules: {
    'no-silent-catch': noSilentCatchRule,
  },
};
