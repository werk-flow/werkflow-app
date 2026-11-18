// Realtime and freshness lint rules (docs/technical/realtime-and-caching.md).
// Each rule names the rule of that doc it enforces (decision 0005).

import { relative, resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

function repositoryPath(filename) {
  return relative(REPOSITORY_ROOT, filename).replaceAll('\\', '/');
}

// `name(…)`, `window.name(…)`, `globalThis['name'](…)`, `timers.name(…)`.
function callsFunctionNamed(node, name) {
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === name;
  if (callee.type !== 'MemberExpression') return false;
  const { property } = callee;
  if (!callee.computed) return property.type === 'Identifier' && property.name === name;
  return property.type === 'Literal' && property.value === name;
}

function isIntervalCall(node) {
  return callsFunctionNamed(node, 'setInterval');
}

/** Every node under `node`, itself included. */
function* nodesUnder(node, visitorKeys) {
  yield node;
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    for (const each of Array.isArray(child) ? child : [child])
      if (each && typeof each.type === 'string') yield* nodesUnder(each, visitorKeys);
  }
}

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

/**
 * The nodes a call of the function `node` runs: its body, without the bodies of the functions it
 * only creates (a handler it installs runs later, if ever), but with a function it calls at once.
 */
function* executedUnder(node, visitorKeys, root = node) {
  yield node;
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    for (const each of Array.isArray(child) ? child : [child]) {
      if (!each || typeof each.type !== 'string') continue;
      const invokedAtOnce = node.type === 'CallExpression' && key === 'callee';
      if (FUNCTION_TYPES.has(each.type) && each !== root && !invokedAtOnce) continue;
      yield* executedUnder(each, visitorKeys, root);
    }
  }
}

/** The variable `identifier` names in its scope, or undefined for a global. */
function variableOf(identifier, sourceCode) {
  for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
  }
  return undefined;
}

/**
 * The state variable of a `useState` setter variable, `const [value, setValue] = useState(…)`, or
 * undefined for any other variable.
 */
function stateOfSetter(setter, sourceCode) {
  const declarator = setter?.defs[0]?.node;
  if (declarator?.type !== 'VariableDeclarator') return undefined;
  const { id, init } = declarator;
  if (id.type !== 'ArrayPattern' || init?.type !== 'CallExpression') return undefined;
  if (!callsFunctionNamed(init, 'useState')) return undefined;
  const [value, setterName] = id.elements;
  if (value?.type !== 'Identifier' || setterName?.type !== 'Identifier') return undefined;
  if (setterName.name !== setter.name) return undefined;
  return variableOf(value, sourceCode);
}

/**
 * The function an effect or a timeout runs: the argument itself, or for a name (`setTimeout(tick,
 * 1000)`, `useEffect(runCountdown, [left])`) the function that name is declared as
 * (`const tick = () => …` or `function tick() {…}`).
 */
function calledFunction(argument, sourceCode) {
  if (argument?.type !== 'Identifier') return argument;
  const variable = variableOf(argument, sourceCode);
  // A reassigned name may hold another function by now; only a name that keeps its declaration counts.
  if (variable?.references.some((reference) => reference.isWrite() && !reference.init)) return argument;
  const definition = variable?.defs[0];
  if (definition?.type === 'FunctionName') return definition.node;
  const init = definition?.type === 'Variable' ? definition.node.init : undefined;
  return init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression' ? init : argument;
}

/** Whether `node` lies inside `container`. */
function within(node, container) {
  return node.range[0] >= container.range[0] && node.range[1] <= container.range[1];
}

/**
 * Whether a setter's argument derives the new value from the current one: it reads the state
 * (`setValue(value - 1)`), or it is an updater that reads its parameter (`setValue((previous) => …)`).
 */
function derivesFromState(argument, state, sourceCode) {
  if (state.references.some((reference) => within(reference.identifier, argument))) return true;
  if (argument.type !== 'ArrowFunctionExpression' && argument.type !== 'FunctionExpression') return false;
  const [previous] = argument.params;
  if (previous?.type !== 'Identifier') return false;
  const parameter = sourceCode
    .getDeclaredVariables(argument)
    .find(
      (variable) => variable.name === previous.name && variable.defs.some((def) => def.type === 'Parameter'),
    );
  return (parameter?.references.length ?? 0) > 0;
}

/**
 * The setter call that makes an effect's timeout an interval: inside a `setTimeout` callback, a
 * call that derives a state the effect depends on from its current value, so every update starts
 * the next timeout.
 */
function rearmingUpdate(effect, sourceCode) {
  const { visitorKeys } = sourceCode;
  const [argument, dependencies] = effect.arguments;
  // A named effect (`useEffect(runCountdown, [left])`) is read like an inline one.
  const callback = calledFunction(argument, sourceCode);
  if (!callback || dependencies?.type !== 'ArrayExpression') return undefined;
  const dependsOn = new Set(
    dependencies.elements
      .filter((element) => element?.type === 'Identifier')
      .map((element) => variableOf(element, sourceCode)),
  );
  for (const timeout of nodesUnder(callback, visitorKeys)) {
    if (timeout.type !== 'CallExpression' || !callsFunctionNamed(timeout, 'setTimeout')) continue;
    const onTimeout = calledFunction(timeout.arguments[0], sourceCode);
    if (!onTimeout) continue;
    for (const update of executedUnder(onTimeout, visitorKeys)) {
      if (update.type !== 'CallExpression' || update.callee.type !== 'Identifier') continue;
      const [argument] = update.arguments;
      if (!argument) continue;
      const state = stateOfSetter(variableOf(update.callee, sourceCode), sourceCode);
      if (state && dependsOn.has(state) && derivesFromState(argument, state, sourceCode)) return update;
    }
  }
  return undefined;
}

/**
 * No polling: live data comes from Realtime through the live-view hooks, and
 * a wall-clock tick goes through hooks/use-wall-clock-tick.ts. The rule stands
 * on its own, so a disable of `no-restricted-syntax` does not switch it off,
 * and eslint.config.mjs refuses an inline disable of it
 * (`eslint-comments/no-restricted-disable`). `allow` lists the files that may
 * start an interval, each with its reason; the list only shrinks: a listed
 * file without an interval is reported as stale. A timeout that an effect
 * starts again through its own state update (a countdown that subtracts one
 * per timeout) is an interval too: its count follows the timers the browser
 * ran, not the clock.
 */
const noIntervalRule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allow: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'reason'],
              properties: {
                file: { type: 'string', minLength: 1 },
                reason: { type: 'string', minLength: 20 },
              },
            },
          },
        },
      },
    ],
    messages: {
      interval:
        'No polling: live data comes from Realtime through useLiveView or useRealtimeRouterRefresh, and a wall-clock tick goes through useWallClockTick or startWallClockInterval (hooks/use-wall-clock-tick.ts). See docs/technical/realtime-and-caching.md, Never.',
      rearmedTimeout:
        'This timeout starts again through its own state update, an interval that counts the timers the browser ran. Derive the value from the clock with useWallClockTick (hooks/use-wall-clock-tick.ts). See docs/technical/realtime-and-caching.md, Never.',
      staleAllow:
        'This file is listed in the realtime/no-interval allow list but starts no interval: remove it from eslint.config.mjs.',
    },
  },
  create(context) {
    const file = repositoryPath(context.filename);
    const allowed = (context.options[0]?.allow ?? []).some((entry) => entry.file === file);
    let found = false;
    const effects = [];
    return {
      CallExpression(node) {
        if (callsFunctionNamed(node, 'useEffect') || callsFunctionNamed(node, 'useLayoutEffect'))
          effects.push(node);
        if (!isIntervalCall(node)) return;
        found = true;
        if (!allowed) context.report({ node, messageId: 'interval' });
      },
      'Program:exit'(program) {
        if (allowed && !found) context.report({ node: program, messageId: 'staleAllow' });
        for (const effect of effects) {
          const update = rearmingUpdate(effect, context.sourceCode);
          if (update) context.report({ node: update, messageId: 'rearmedTimeout' });
        }
      },
    };
  },
};

export const realtimeRules = {
  rules: {
    'no-interval': noIntervalRule,
  },
};
