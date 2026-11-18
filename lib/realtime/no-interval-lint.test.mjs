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

  test('a timeout an effect starts again through its own state update is refused', async () => {
    const countdown = (update) =>
      `'use client';\nimport { useEffect, useState } from 'react';\nexport function useProbe() {\n  const [left, setLeft] = useState(60);\n  useEffect(() => {\n    if (left <= 0) return;\n    const timer = window.setTimeout(() => {\n      ${update};\n    }, 1000);\n    return () => window.clearTimeout(timer);\n  }, [left]);\n  return left;\n}\n`;
    expect(await intervalFindings(countdown('setLeft((previous) => previous - 1)'))).toEqual([
      'realtime/no-interval',
    ]);
    expect(
      await intervalFindings(countdown('setLeft(function (previous) { return previous - 1; })')),
    ).toEqual(['realtime/no-interval']);
    expect(await intervalFindings(countdown('setLeft(left - 1)'))).toEqual(['realtime/no-interval']);
    // Each setter resolves to its own state: an earlier hook's same-named setter changes nothing.
    const otherHookFirst = countdown('setLeft((previous) => previous - 1)').replace(
      'export function useProbe',
      'export function useOther() {\n  const [other, setLeft] = useState(0);\n  return [other, setLeft] as const;\n}\nexport function useProbe',
    );
    expect(await intervalFindings(otherHookFirst)).toEqual(['realtime/no-interval']);
    // A local function that shadows the setter is no state update.
    expect(
      await intervalFindings(
        countdown('const setLeft = (value) => value;\n      setLeft((previous) => previous - 1)'),
      ),
    ).toEqual([]);
    // A one-shot timeout that resets the state ends the chain: the effect's guard stops it.
    expect(await intervalFindings(countdown('setLeft(0)'))).toEqual([]);
    expect(await intervalFindings(countdown('setLeft(() => 0)'))).toEqual([]);
    // A named callback counts like an inline one.
    const named = (body) =>
      countdown('').replace(
        /const timer = window\.setTimeout\(\(\) => \{\n.*\n    \}, 1000\);/,
        `const tick = () => ${body};\n    const timer = window.setTimeout(tick, 1000);`,
      );
    expect(await intervalFindings(named('setLeft((previous) => previous - 1)'))).toEqual([
      'realtime/no-interval',
    ]);
    expect(await intervalFindings(named('setLeft(0)'))).toEqual([]);
    // A named effect counts like an inline one.
    const namedEffect = countdown('setLeft((previous) => previous - 1)')
      .replace('  useEffect(() => {\n', '  const runCountdown = () => {\n')
      .replace('  }, [left]);', '  };\n  useEffect(runCountdown, [left]);');
    expect(await intervalFindings(namedEffect)).toEqual(['realtime/no-interval']);
    // A handler the timeout only installs runs later, if ever; a function it calls at once runs now.
    expect(
      await intervalFindings(countdown('document.body.onclick = () => setLeft((previous) => previous - 1)')),
    ).toEqual([]);
    expect(await intervalFindings(countdown('(() => setLeft((previous) => previous - 1))()'))).toEqual([
      'realtime/no-interval',
    ]);
    // A reassigned name is not read as its first function.
    const reassigned = named('setLeft((previous) => previous - 1)')
      .replace('const tick =', 'let tick =')
      .replace('const timer', 'tick = () => setLeft(0);\n    const timer');
    expect(await intervalFindings(reassigned)).toEqual([]);
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
