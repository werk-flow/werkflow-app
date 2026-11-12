import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, optimize } from '@tailwindcss/node';

// Tailwind is the build step that can empty a keyframe: its color-mix() polyfill
// nests an @supports inside the keyframe, and its Lightning CSS pass then drops
// that whole keyframe. Production served `@keyframes green-glow{}` for seven weeks.
// Turbopack's own CSS pass keeps every keyframe Tailwind hands it.
const appDirectory = resolve(import.meta.dir, '../../app');

/** The body of the block whose `{` sits at `open`, and the index after its `}`. */
function block(css: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return { body: css.slice(open + 1, index), end: index + 1 };
  }
  throw new Error(`Unclosed block at ${open}`);
}

/** Each @keyframes name, each offset (`from` as 0%, `to` as 100%), the properties it sets directly. */
function keyframeProperties(stylesheet: string): Map<string, Map<string, Set<string>>> {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = new Map<string, Map<string, Set<string>>>();
  for (const match of css.matchAll(/@keyframes\s+([^\s{]+)\s*\{/g)) {
    const [, name = ''] = match;
    const offsets = blocks.get(name) ?? new Map<string, Set<string>>();
    blocks.set(name, offsets);
    const keyframes = block(css, match.index + match[0].length - 1).body;
    for (let start = 0, open = keyframes.indexOf('{'); open !== -1; open = keyframes.indexOf('{', start)) {
      const frame = block(keyframes, open);
      // Only declarations at the frame's own level count; a nested block is not one.
      const own = frame.body.replace(/[^;{}]*\{[^{}]*\}/g, '');
      const properties = own.split(';').flatMap((declaration) => {
        const colon = declaration.indexOf(':');
        return colon > 0 ? [declaration.slice(0, colon).trim()] : [];
      });
      for (const selector of keyframes.slice(start, open).split(',')) {
        const offset = { from: '0%', to: '100%' }[selector.trim()] ?? selector.trim();
        offsets.set(offset, new Set([...(offsets.get(offset) ?? []), ...properties]));
      }
      start = frame.end;
    }
  }
  return blocks;
}

/** Every keyframe property the source sets and the production Tailwind step drops. */
async function keyframesLostInBuild(source: string): Promise<string[]> {
  // What @tailwindcss/postcss does under NODE_ENV=production: compile with every
  // polyfill, then optimize and minify with Lightning CSS.
  const compiler = await compile(source, { base: appDirectory, onDependency: () => {} });
  const built = keyframeProperties(optimize(compiler.build([]), { minify: true }).code);
  const lost: string[] = [];
  for (const [name, offsets] of keyframeProperties(source)) {
    for (const [offset, properties] of offsets) {
      const kept = built.get(name)?.get(offset);
      for (const property of properties) {
        if (!kept?.has(property)) lost.push(`@keyframes ${name} ${offset} { ${property} }`);
      }
    }
  }
  return lost;
}

test('the production build keeps every keyframe declaration of app/globals.css', async () => {
  const lost = await keyframesLostInBuild(readFileSync(resolve(appDirectory, 'globals.css'), 'utf8'));
  // A lost keyframe holds color-mix() (or a variable set to it) inside @keyframes.
  // Mix the color in a :root token and reference the token with var() in the keyframe.
  expect(lost).toEqual([]);
});

test('the keyframe check sees a keyframe the build empties', async () => {
  // green-glow as it shipped from 2026-09-24 (the build served `@keyframes green-glow{}`),
  // beside a plain keyframe the build keeps, which must not count as lost.
  const emptied = `@import 'tailwindcss' source(none);
:root { --success: #15803d; }
@keyframes green-glow {
  0%, 100% { filter: drop-shadow(0 0 12px color-mix(in oklab, var(--success) 35%, transparent)); }
  50% { filter: drop-shadow(0 0 22px color-mix(in oklab, var(--success) 55%, transparent)); }
}
@keyframes kept { from { opacity: 0; } to { opacity: 1; } }`;
  expect(await keyframesLostInBuild(emptied)).toEqual([
    '@keyframes green-glow 0% { filter }',
    '@keyframes green-glow 100% { filter }',
    '@keyframes green-glow 50% { filter }',
  ]);
});
