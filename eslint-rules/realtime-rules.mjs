// Realtime and freshness lint rules (docs/technical/realtime-and-caching.md).
// Each rule names the rule of that doc it enforces (decision 0005).

import { relative, resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

function repositoryPath(filename) {
  return relative(REPOSITORY_ROOT, filename).replaceAll('\\', '/');
}

// `setInterval(…)`, `window.setInterval(…)`, `globalThis['setInterval'](…)`, `timers.setInterval(…)`.
function isIntervalCall(node) {
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === 'setInterval';
  if (callee.type !== 'MemberExpression') return false;
  const { property } = callee;
  if (!callee.computed) return property.type === 'Identifier' && property.name === 'setInterval';
  return property.type === 'Literal' && property.value === 'setInterval';
}

/**
 * No polling: live data comes from Realtime through the live-view hooks, and
 * a wall-clock tick goes through hooks/use-wall-clock-tick.ts. The rule stands
 * on its own, so a disable of `no-restricted-syntax` does not switch it off,
 * and eslint.config.mjs refuses an inline disable of it
 * (`eslint-comments/no-restricted-disable`). `allow` lists the files that may
 * start an interval, each with its reason; the list only shrinks: a listed
 * file without an interval is reported as stale.
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
      staleAllow:
        'This file is listed in the realtime/no-interval allow list but starts no interval: remove it from eslint.config.mjs.',
    },
  },
  create(context) {
    const file = repositoryPath(context.filename);
    const allowed = (context.options[0]?.allow ?? []).some((entry) => entry.file === file);
    let found = false;
    return {
      CallExpression(node) {
        if (!isIntervalCall(node)) return;
        found = true;
        if (!allowed) context.report({ node, messageId: 'interval' });
      },
      'Program:exit'(program) {
        if (allowed && !found) context.report({ node: program, messageId: 'staleAllow' });
      },
    };
  },
};

export const realtimeRules = {
  rules: {
    'no-interval': noIntervalRule,
  },
};
