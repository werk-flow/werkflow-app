// The one measurement of a function's size and its stable name, shared by the
// quality/function-size lint rule (eslint-rules/quality-rules.mjs) and the
// stale-entry check of the size-cap exceptions
// (lib/conventions/module-caps.test.ts). Both walk the ESLint AST, so the rule
// and the check can never disagree about a function's size or its key.

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** True for the ESLint node types that are functions. */
function isFunctionNode(node) {
  return FUNCTION_TYPES.has(node?.type);
}

/** A method or accessor body measures from its key, as max-lines-per-function does. */
function measuredNode(node) {
  const { parent } = node;
  if (parent?.type === 'MethodDefinition') return parent;
  if (parent?.type === 'Property' && (parent.method || parent.kind === 'get' || parent.kind === 'set')) {
    return parent;
  }
  return node;
}

/** An immediately invoked function belongs to its surroundings, as in max-lines-per-function. */
function isImmediatelyInvoked(node) {
  return node.parent?.type === 'CallExpression' && node.parent.callee === node;
}

function isFullLineComment(line, lineNumber, comment) {
  const { start, end } = comment.loc;
  const startsLine = start.line === lineNumber && !line.slice(0, start.column).trim();
  const endsLine = end.line === lineNumber && !line.slice(end.column).trim();
  return (start.line < lineNumber || startsLine) && (end.line > lineNumber || endsLine);
}

/**
 * The lines of a function without blank lines and full-line comments: the
 * count of `max-lines-per-function` with skipBlankLines and skipComments.
 */
function countFunctionLines(sourceCode, node) {
  const commentByLine = new Map();
  for (const comment of sourceCode.getAllComments()) {
    for (let line = comment.loc.start.line; line <= comment.loc.end.line; line += 1) {
      commentByLine.set(line, comment);
    }
  }
  const { start, end } = measuredNode(node).loc;
  let count = 0;
  for (let lineNumber = start.line; lineNumber <= end.line; lineNumber += 1) {
    const line = sourceCode.lines[lineNumber - 1] ?? '';
    const comment = commentByLine.get(lineNumber);
    if (comment && isFullLineComment(line, lineNumber, comment)) continue;
    if (/^\s*$/u.test(line)) continue;
    count += 1;
  }
  return count;
}

function propertyName(key) {
  if (!key) return null;
  if (key.type === 'Identifier' || key.type === 'PrivateIdentifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return null;
}

/** The name the source gives the function itself, or null for an anonymous callback. */
function declaredName(node) {
  if (node.id?.name) return node.id.name;
  const { parent } = node;
  switch (parent?.type) {
    case 'VariableDeclarator':
      return parent.id.type === 'Identifier' ? parent.id.name : null;
    case 'MethodDefinition':
    case 'Property':
    case 'PropertyDefinition':
      return parent.computed ? null : propertyName(parent.key);
    case 'AssignmentExpression':
      if (parent.left.type === 'Identifier') return parent.left.name;
      return parent.left.type === 'MemberExpression' ? propertyName(parent.left.property) : null;
    case 'ExportDefaultDeclaration':
      return 'default';
    case 'CallExpression':
      // A callback bound through a wrapper takes the variable's name:
      // `const handleSave = useCallback(() => …)`, `const Input = forwardRef(…)`.
      return parent.callee !== node &&
        parent.parent?.type === 'VariableDeclarator' &&
        parent.parent.id.type === 'Identifier'
        ? parent.parent.id.name
        : null;
    default:
      return null;
  }
}

/** The label of an anonymous function: the call it is passed to, or the JSX prop it fills. */
function anonymousLabel(node) {
  const { parent } = node;
  if (parent?.type === 'CallExpression' && parent.callee !== node) {
    const { callee } = parent;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') return propertyName(callee.property) ?? 'anonymous';
  }
  if (parent?.type === 'JSXExpressionContainer' && parent.parent?.type === 'JSXAttribute') {
    const name = parent.parent.name;
    return name.type === 'JSXIdentifier' ? name.name : 'anonymous';
  }
  return 'anonymous';
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunctionNode(current)) return current;
  }
  return null;
}

/**
 * A namer for one file. Call it for every function in source order (ESLint's
 * traversal order): the key is the chain of enclosing function names joined
 * by ` > `, never a line number, so it survives edits elsewhere in the file.
 * An anonymous callback is named by its call or JSX prop with its ordinal
 * (`CalendarContainer > useCallback#2`); a repeated name gets `#n` from its
 * second occurrence on.
 */
function createFunctionNamer() {
  const keys = new Map();
  const occurrences = new Map();
  return function keyOf(node) {
    const known = keys.get(node);
    if (known) return known;
    const outer = enclosingFunction(node);
    const name = declaredName(node);
    const label = name ?? anonymousLabel(node);
    const base = outer ? `${keyOf(outer)} > ${label}` : label;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const key = name && occurrence === 1 ? base : `${base}#${occurrence}`;
    keys.set(node, key);
    return key;
  };
}

/** Every measured function of a parsed file in source order, with its key and size. */
export function measureFunctions(sourceCode) {
  const keyOf = createFunctionNamer();
  const measured = [];
  function visit(node) {
    if (isFunctionNode(node)) {
      const key = keyOf(node);
      if (!isImmediatelyInvoked(node)) {
        measured.push({ key, lines: countFunctionLines(sourceCode, node), node });
      }
    }
    for (const field of sourceCode.visitorKeys[node.type] ?? []) {
      const child = node[field];
      if (Array.isArray(child)) {
        for (const item of child) if (item && typeof item.type === 'string') visit(item);
      } else if (child && typeof child.type === 'string') {
        visit(child);
      }
    }
  }
  visit(sourceCode.ast);
  return measured;
}
