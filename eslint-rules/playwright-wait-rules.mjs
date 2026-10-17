import { dirname, resolve as resolvePath } from 'node:path';

// Wait rules of the browser tests (docs/technical/testing.md, Checklist and
// Never). A failure shows within the configured wait, and a wait that outlasts
// it names its slow operation in one reviewed registry.

/** The `expect.timeout` of playwright.config.ts, playwright.audit.config.ts and playwright.canary.config.ts. */
export const CONFIGURED_EXPECT_TIMEOUT_MS = 10_000;

/** The one module whose constants may outlast the configured expect timeout. */
export const TIMEOUT_REGISTRY_MODULE = 'tests/golden/support/timeouts.ts';

/**
 * The longest wait the registry may hold: twice the longest operation the
 * archived local runs measured (a document upload, about 15 s), doubled again
 * for the cloud target. A longer wait hides a hang inside the test timeout.
 */
export const MAX_REGISTERED_TIMEOUT_MS = 60_000;

/**
 * The module that owns the measured deadlines of the freshness checks. Its
 * hard budget bounds a diagnosis, and lib/testing/responsiveness-tolerance.ts
 * reviews its values with the live target.
 */
const DEADLINE_MODULE = 'lib/testing/responsiveness-tolerance.ts';

/**
 * Support modules that are lab measurement-digest inputs
 * (lib/testing/lab-count-context.ts). Their whole content is part of every lab
 * reference, so no wait rule may force an edit; playwright-spec-rules.test.mjs
 * keeps the list complete.
 */
export const LAB_DIGEST_SUPPORT_FILES = [
  'tests/audit/support/lab-probe.ts',
  'tests/audit/support/lab-network.ts',
  'tests/audit/support/lab-recorder.ts',
];

/** `timeout`, `clickTimeout`, `hardTimeoutMs`, `actionTimeout` and the like. */
const TIMEOUT_NAME = /^timeout(?:Ms)?$|Timeout(?:Ms)?$/;

function keyName(property) {
  if (property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  return typeof property.key.value === 'string' ? property.key.value : null;
}

function stripModuleExtension(path) {
  return path.replace(/\.(?:ts|tsx|js|mjs)$/, '');
}

/** The variable an identifier refers to, or null when it is a global. */
function variableOf(context, identifier) {
  let scope = context.sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function rootIdentifier(node) {
  let current = node;
  while (current.type === 'MemberExpression') current = current.object;
  return current.type === 'Identifier' ? current : null;
}

function lastMemberName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression' || node.computed || node.property.type !== 'Identifier') return null;
  return node.property.name;
}

/**
 * A wait in a browser test lasts at most the configured expect timeout, or it
 * names its slow operation through a constant of the registry module. A
 * literal, a local constant or a constant of any other module above the limit
 * is refused, and so is a computed value. A helper that takes a wait takes it
 * as a `timeout` option, which its callers' lint checks in turn; a positional
 * timeout parameter would hide the caller's value from this rule.
 */
export const boundedTimeoutRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      literal: `A wait of {{value}} ms outlasts the configured expect timeout (${CONFIGURED_EXPECT_TIMEOUT_MS} ms). Drop the option so the default applies, or name the slow operation with a constant of ${TIMEOUT_REGISTRY_MODULE}.`,
      unregistered: `A wait above ${CONFIGURED_EXPECT_TIMEOUT_MS} ms takes its length from a constant of ${TIMEOUT_REGISTRY_MODULE}, a measured deadline of ${DEADLINE_MODULE}, or a forwarded timeout option; {{source}} is none of them.`,
      unbounded:
        'A timeout of 0 waits without a limit until the test timeout ends the run. Drop the option so the configured default applies.',
      positional: `A helper takes a wait as a \`timeout\` option, never as the positional parameter {{name}}: the caller's value must stay visible to playwright-spec/bounded-timeout.`,
    },
  },
  create(context) {
    const cwd = context.cwd ?? process.cwd();
    const registry = stripModuleExtension(resolvePath(cwd, TIMEOUT_REGISTRY_MODULE));
    const deadlines = stripModuleExtension(resolvePath(cwd, DEADLINE_MODULE));

    function importedFromAllowedModule(variable) {
      const definition = variable.defs[0];
      if (definition?.type !== 'ImportBinding') return false;
      const source = definition.parent.source.value;
      if (typeof source !== 'string' || !source.startsWith('.')) return false;
      const target = stripModuleExtension(resolvePath(dirname(context.filename), source));
      return target === registry || target === deadlines;
    }

    /** Null when the value is allowed; otherwise the problem to report. */
    function problemOf(value, seen) {
      if (!value || seen.has(value)) return null;
      seen.add(value);
      if (value.type === 'Literal') {
        if (value.value === 0) return { messageId: 'unbounded' };
        if (typeof value.value !== 'number' || value.value <= CONFIGURED_EXPECT_TIMEOUT_MS) return null;
        return { messageId: 'literal', data: { value: String(value.value) } };
      }
      if (value.type === 'TSAsExpression' || value.type === 'TSSatisfiesExpression')
        return problemOf(value.expression, seen);
      if (value.type === 'ConditionalExpression')
        return problemOf(value.consequent, seen) ?? problemOf(value.alternate, seen);
      const root =
        value.type === 'Identifier' || value.type === 'MemberExpression' ? rootIdentifier(value) : null;
      const variable = root ? variableOf(context, root) : null;
      if (!variable) return unregistered(value);
      if (importedFromAllowedModule(variable)) return null;
      const definition = variable.defs[0];
      if (definition?.type === 'Parameter') {
        // Forwarding the caller's timeout option keeps its value checked at the call site.
        const name = lastMemberName(value);
        return name && TIMEOUT_NAME.test(name) ? null : unregistered(value);
      }
      if (
        definition?.type === 'Variable' &&
        definition.parent?.kind === 'const' &&
        value.type === 'Identifier'
      )
        return problemOf(definition.node.init, seen);
      if (definition?.type === 'Variable' && definition.node.id.type === 'ObjectPattern') {
        // `const { timeout } = options` inside a helper forwards the caller's option.
        const source = definition.node.init?.type === 'Identifier' ? definition.node.init : null;
        const sourceVariable = source ? variableOf(context, source) : null;
        const forwarded = TIMEOUT_NAME.test(root.name) && sourceVariable?.defs[0]?.type === 'Parameter';
        return forwarded ? null : unregistered(value);
      }
      return unregistered(value);
    }

    function unregistered(value) {
      return { messageId: 'unregistered', data: { source: `\`${context.sourceCode.getText(value)}\`` } };
    }

    function checkParameters(node) {
      for (const parameter of node.params) {
        const target = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
        if (target.type === 'Identifier' && TIMEOUT_NAME.test(target.name))
          context.report({ node: target, messageId: 'positional', data: { name: target.name } });
      }
    }

    return {
      Property(node) {
        if (node.parent.type !== 'ObjectExpression') return;
        const name = keyName(node);
        if (!name || !TIMEOUT_NAME.test(name)) return;
        const problem = problemOf(node.value, new Set());
        if (problem) context.report({ node: node.value, ...problem });
      },
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
    };
  },
};

/** Playwright calls that act on the page; repeating one is a retry of the user's step. */
const ACTIONS = new Set([
  'check',
  'clear',
  'click',
  'dblclick',
  'dispatchEvent',
  'dragTo',
  'fill',
  'goBack',
  'goForward',
  'goto',
  'hover',
  'press',
  'pressSequentially',
  'reload',
  'selectOption',
  'setChecked',
  'setInputFiles',
  'tap',
  'type',
  'uncheck',
]);

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

function memberName(callee) {
  if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier')
    return null;
  return callee.property.name;
}

/** The first action call inside a function body, nested callbacks included. */
function findAction(visitorKeys, node) {
  if (!node || typeof node.type !== 'string') return null;
  if (node.type === 'CallExpression' && ACTIONS.has(memberName(node.callee))) return node;
  for (const key of visitorKeys[node.type] ?? []) {
    const children = Array.isArray(node[key]) ? node[key] : [node[key]];
    for (const child of children) {
      const found = findAction(visitorKeys, child);
      if (found) return found;
    }
  }
  return null;
}

/** True for `() => false`, `() => null`, `() => undefined`, `() => void 0`, `() => {}`, `() => []`, `() => ({})` and the like. */
function swallowsFailure(handler) {
  if (!handler || !FUNCTION_TYPES.has(handler.type)) return false;
  return isSwallowedValue(handler.body);
}

/** A handler body that yields nothing or a constant: an empty block, `{ return false; }`, `false`, `[]`. */
function isSwallowedValue(body) {
  if (body.type === 'BlockStatement') {
    if (body.body.length === 0) return true;
    const [only] = body.body;
    return (
      body.body.length === 1 &&
      only.type === 'ReturnStatement' &&
      (!only.argument || isSwallowedValue(only.argument))
    );
  }
  if (body.type === 'Literal') return true;
  if (body.type === 'UnaryExpression' && body.operator === 'void') return true;
  if (body.type === 'ArrayExpression') return body.elements.length === 0;
  if (body.type === 'ObjectExpression') return body.properties.length === 0;
  return body.type === 'Identifier' && body.name === 'undefined';
}

/**
 * A spec performs each step once and waits for the exact fact that makes it
 * possible (testing.md, Never: "retry until green"). A step repeated inside
 * expect(...).toPass() hides why the first attempt failed, and a `.catch`
 * that turns a failure into a constant hides a strict-mode violation or a
 * closed page behind a quiet branch.
 */
export const noRetriedActionRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      retriedAction:
        'expect(...).toPass() repeats the {{action}} until it works, which hides why the first attempt failed. Wait for the fact that makes the step possible (a readiness mark, a settled scope), then act once.',
      swallowed:
        'This .catch turns a failure into a constant, so a strict-mode violation or a closed page passes as a quiet branch. Let the call fail, or wait for the exact fact first.',
    },
  },
  create(context) {
    const { visitorKeys } = context.sourceCode;
    return {
      CallExpression(node) {
        const name = memberName(node.callee);
        if (name === 'catch') {
          if (swallowsFailure(node.arguments[0])) context.report({ node, messageId: 'swallowed' });
          return;
        }
        if (name !== 'toPass') return;
        const expectCall = node.callee.object;
        const callback = expectCall.type === 'CallExpression' ? expectCall.arguments[0] : null;
        if (!callback || !FUNCTION_TYPES.has(callback.type)) return;
        const action = findAction(visitorKeys, callback.body);
        if (action)
          context.report({
            node: action,
            messageId: 'retriedAction',
            data: { action: memberName(action.callee) },
          });
      },
    };
  },
};
