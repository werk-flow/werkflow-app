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

/**
 * The setters of `useState` pairs, `const [value, setValue] = useState(…)`, by name, each with
 * its value's name.
 */
function stateOfSetter(declarator) {
  const { id, init } = declarator;
  if (id.type !== 'ArrayPattern' || init?.type !== 'CallExpression') return undefined;
  if (!callsFunctionNamed(init, 'useState')) return undefined;
  const [value, setter] = id.elements;
  if (value?.type !== 'Identifier' || setter?.type !== 'Identifier') return undefined;
  return [setter.name, value.name];
}

/**
 * The setter call that makes an effect's timeout an interval: inside a `setTimeout` callback, an
 * updater call (`setValue((previous) => …)`) of a state the effect depends on, so every update
 * starts the next timeout.
 */
function rearmingUpdate(effect, setters, visitorKeys) {
  const [callback, dependencies] = effect.arguments;
  if (!callback || dependencies?.type !== 'ArrayExpression') return undefined;
  const dependsOn = new Set(
    dependencies.elements.filter((element) => element?.type === 'Identifier').map(({ name }) => name),
  );
  for (const timeout of nodesUnder(callback, visitorKeys)) {
    if (timeout.type !== 'CallExpression' || !callsFunctionNamed(timeout, 'setTimeout')) continue;
    const [onTimeout] = timeout.arguments;
    if (!onTimeout) continue;
    for (const update of nodesUnder(onTimeout, visitorKeys)) {
      if (update.type !== 'CallExpression' || update.callee.type !== 'Identifier') continue;
      const [updater] = update.arguments;
      const isUpdater = updater?.type === 'ArrowFunctionExpression' || updater?.type === 'FunctionExpression';
      if (isUpdater && dependsOn.has(setters.get(update.callee.name))) return update;
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
    const { visitorKeys } = context.sourceCode;
    let found = false;
    const setters = new Map();
    const effects = [];
    return {
      VariableDeclarator(node) {
        const pair = stateOfSetter(node);
        if (pair) setters.set(...pair);
      },
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
          const update = rearmingUpdate(effect, setters, visitorKeys);
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
