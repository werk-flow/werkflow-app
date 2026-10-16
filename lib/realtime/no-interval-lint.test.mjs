import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { createProbeLinter } from '../../eslint-rules/probe-linter.mjs';

// realtime/no-interval: no product code polls, and the one wall-clock primitive is the only interval.
const eslint = createProbeLinter();
const TICK_HOME = 'hooks/use-wall-clock-tick.ts';

async function intervalFindings(source, filePath = 'components/interval-probe.tsx') {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages
    .filter(
      ({ ruleId }) =>
        ruleId === 'realtime/no-interval' ||
        ruleId === '@eslint-community/eslint-comments/no-restricted-disable',
    )
    .map(({ ruleId }) => ruleId);
}

describe('realtime/no-interval', () => {
  test('refuses every interval in product code', async () => {
    for (const call of [
      'setInterval(tick, 1000)',
      'window.setInterval(tick, 1000)',
      'globalThis.setInterval(tick, 1000)',
      'self.setInterval(tick, 1000)',
      "window['setInterval'](tick, 1000)",
    ]) {
      const source = `export function probe(tick: () => void) { return ${call}; }\n`;
      expect(await intervalFindings(source), call).toEqual(['realtime/no-interval']);
      expect(await intervalFindings(source, 'lib/probe/interval.ts'), call).toEqual(['realtime/no-interval']);
    }
  });

  test('an inline disable cannot switch it off', async () => {
    const restrictedSyntax =
      'export function probe(tick: () => void) {\n  // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick\n  return window.setInterval(tick, 1000);\n}\n';
    expect(await intervalFindings(restrictedSyntax)).toEqual(['realtime/no-interval']);
    const ownRule =
      'export function probe(tick: () => void) {\n  // eslint-disable-next-line realtime/no-interval -- wall-clock render tick\n  return window.setInterval(tick, 1000);\n}\n';
    expect(await intervalFindings(ownRule)).toEqual([
      '@eslint-community/eslint-comments/no-restricted-disable',
    ]);
  });

  test('the listed tick home passes and is reported once it starts no interval', async () => {
    expect(await intervalFindings(readFileSync(TICK_HOME, 'utf8'), TICK_HOME)).toEqual([]);
    expect(await intervalFindings("'use client';\nexport const probe = 1;\n", TICK_HOME)).toEqual([
      'realtime/no-interval',
    ]);
  });

  test('a timeout and a name that only mentions the interval pass', async () => {
    for (const source of [
      'export function probe(tick: () => void) { return window.setTimeout(tick, 1000); }\n',
      "export function probe(setIntervalValue: (value: string) => void) { setIntervalValue('1'); }\n",
    ]) {
      expect(await intervalFindings(source), source).toEqual([]);
    }
  });
});
