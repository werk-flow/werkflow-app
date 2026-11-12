import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss, { type Root } from 'postcss';

// Tailwind is the build step that can empty a keyframe: its color-mix() polyfill
// nests an @supports inside the keyframe, and its Lightning CSS pass then drops
// that whole keyframe. Production served `@keyframes green-glow{}` for seven weeks.
// Turbopack's own CSS pass keeps every keyframe Tailwind hands it.
const appDirectory = resolve(import.meta.dir, '../../app');
const globalsPath = resolve(appDirectory, 'globals.css');

/** Each @keyframes name, each offset (`from` as 0%, `to` as 100%), the properties it sets. */
function keyframeProperties(root: Root): Map<string, Map<string, Set<string>>> {
  const blocks = new Map<string, Map<string, Set<string>>>();
  root.walkAtRules('keyframes', (block) => {
    const offsets = blocks.get(block.params) ?? new Map<string, Set<string>>();
    blocks.set(block.params, offsets);
    block.each((frame) => {
      if (frame.type !== 'rule') return;
      for (const selector of frame.selectors) {
        const offset = { from: '0%', to: '100%' }[selector.trim()] ?? selector.trim();
        const properties = offsets.get(offset) ?? new Set<string>();
        frame.each((node) => {
          if (node.type === 'decl') properties.add(node.prop);
        });
        offsets.set(offset, properties);
      }
    });
  });
  return blocks;
}

/** Every keyframe property the source sets and the production Tailwind step drops. */
async function keyframesLostInBuild(source: string, from: string): Promise<string[]> {
  // `optimize: true` is what @tailwindcss/postcss does under NODE_ENV=production.
  const built = await postcss([tailwindcss({ optimize: true })]).process(source, { from });
  const builtBlocks = keyframeProperties(postcss.parse(built.css));
  const lost: string[] = [];
  for (const [name, offsets] of keyframeProperties(postcss.parse(source))) {
    for (const [offset, properties] of offsets) {
      const kept = builtBlocks.get(name)?.get(offset);
      for (const property of properties) {
        if (!kept?.has(property)) lost.push(`@keyframes ${name} ${offset} { ${property} }`);
      }
    }
  }
  return lost;
}

test('the production build keeps every keyframe declaration of app/globals.css', async () => {
  const lost = await keyframesLostInBuild(readFileSync(globalsPath, 'utf8'), globalsPath);
  // A lost keyframe holds color-mix() (or a variable set to it) inside @keyframes.
  // Mix the color in a :root token and reference the token with var() in the keyframe.
  expect(lost).toEqual([]);
});

test('the keyframe check sees a keyframe the build empties', async () => {
  // green-glow as it shipped from 2026-09-24: the build turned it into `@keyframes green-glow{}`.
  const emptied = `@import 'tailwindcss' source(none);
:root { --success: #15803d; }
@keyframes green-glow {
  0%, 100% { filter: drop-shadow(0 0 12px color-mix(in oklab, var(--success) 35%, transparent)); }
  50% { filter: drop-shadow(0 0 22px color-mix(in oklab, var(--success) 55%, transparent)); }
}`;
  expect(await keyframesLostInBuild(emptied, resolve(appDirectory, 'keyframes-control.css'))).toEqual([
    '@keyframes green-glow 0% { filter }',
    '@keyframes green-glow 100% { filter }',
    '@keyframes green-glow 50% { filter }',
  ]);
});
