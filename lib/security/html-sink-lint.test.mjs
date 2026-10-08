import { expect, test } from 'bun:test';
import { ESLint } from 'eslint';

// Tier 2 probes for htmlSinkSelectors in eslint.config.mjs. The script policy
// still allows 'unsafe-inline', so product code must not create a raw HTML or
// code sink through which an injected value becomes markup or script.
const eslint = new ESLint();

async function sinkMessages(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(
    ({ ruleId, message }) => ruleId === 'no-restricted-syntax' && /security\.md, Browser/.test(message),
  );
}

test('every raw HTML and code sink is rejected in product code', async () => {
  const probes = [
    [
      'components/sink-probe.tsx',
      'export const P = ({ html }) => <div dangerouslySetInnerHTML={{ __html: html }} />;',
    ],
    ['components/sink-probe.tsx', 'export function p(el, value) { el.innerHTML = value; }'],
    ['hooks/sink-probe.ts', 'export function p(el, value) { el.outerHTML = value; }'],
    ['lib/sink-probe.ts', "export function p(el, value) { el.insertAdjacentHTML('beforeend', value); }"],
    ['app/sink-probe.tsx', 'export function p(value) { document.write(value); }'],
    ['lib/sink-probe.ts', 'export function p(value) { return eval(value); }'],
    ['lib/sink-probe.ts', "export function p(value) { return new Function('x', value); }"],
  ];
  for (const [filePath, source] of probes) {
    expect(await sinkMessages(source, filePath), source).toHaveLength(1);
  }
});

test('reading markup and escaped rendering stay allowed', async () => {
  expect(
    await sinkMessages(
      'export const P = ({ text, el }) => { const read = el.innerHTML; return <div title={read}>{text}</div>; };',
      'components/sink-probe.tsx',
    ),
  ).toEqual([]);
});
