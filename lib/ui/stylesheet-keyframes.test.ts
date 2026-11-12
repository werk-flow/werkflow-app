import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, optimize } from '@tailwindcss/node';

// Tailwind is the build step that can empty a keyframe: its color-mix() polyfill
// nests an @supports inside the keyframe, and its Lightning CSS pass then drops
// that whole keyframe. Production served `@keyframes green-glow{}` for seven weeks.
// Turbopack's own CSS pass keeps every keyframe Tailwind hands it.
const appDirectory = resolve(import.meta.dir, '../../app');

/** Offset -> the properties that keyframe sets directly. */
type Frames = Map<string, Set<string>>;

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

/** `from` and `to` as 0% and 100%, and `50.00%` as `50%`, as the minifier writes them. */
function offsetOf(selector: string): string {
  const trimmed = selector.trim();
  const percent = { from: 0, to: 100 }[trimmed] ?? Number.parseFloat(trimmed);
  return Number.isNaN(percent) ? trimmed : `${percent}%`;
}

function framesOf(keyframes: string): Frames {
  const frames: Frames = new Map();
  for (let start = 0, open = keyframes.indexOf('{'); open !== -1; open = keyframes.indexOf('{', start)) {
    const frame = block(keyframes, open);
    // Only declarations at the frame's own level count; a nested block is not one.
    const own = frame.body.replace(/[^;{}]*\{[^{}]*\}/g, '');
    const properties = own.split(';').flatMap((declaration) => {
      const colon = declaration.indexOf(':');
      return colon > 0 ? [declaration.slice(0, colon).trim()] : [];
    });
    for (const selector of keyframes.slice(start, open).split(',')) {
      const offset = offsetOf(selector);
      frames.set(offset, new Set([...(frames.get(offset) ?? []), ...properties]));
    }
    start = frame.end;
  }
  return frames;
}

/**
 * Each @keyframes block under the conditions that enclose it
 * (`@media(prefers-reduced-motion:reduce) @keyframes pulse#0`), so a block in one context never stands in for its
 * namesake in another.
 */
function keyframeBlocks(stylesheet: string): Map<string, Frames> {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = new Map<string, Frames>();
  const enclosing: string[] = [];
  let prelude = '';
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') {
      // The minifier drops the spaces around `:`, `(`, `)` and `,` in a condition.
      const opened = prelude
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/ ?([:(),]) ?/g, '$1');
      prelude = '';
      if (!opened.startsWith('@keyframes')) {
        enclosing.push(opened);
        continue;
      }
      const context = [...enclosing.filter((rule) => rule.startsWith('@')), opened].join(' ');
      let occurrence = 0;
      while (blocks.has(`${context}#${occurrence}`)) occurrence += 1;
      const keyframes = block(css, index);
      blocks.set(`${context}#${occurrence}`, framesOf(keyframes.body));
      index = keyframes.end - 1;
    } else if (character === '}') {
      enclosing.pop();
      prelude = '';
    } else if (character === ';') {
      prelude = '';
    } else {
      prelude += character;
    }
  }
  return blocks;
}

const PHYSICAL_SIDES = new Set(['top', 'right', 'bottom', 'left']);

/** A property's words, with a physical side read as the `inset` longhand it is. */
function wordsOf(property: string): string[] {
  return PHYSICAL_SIDES.has(property) ? ['inset', property] : property.split('-');
}

function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
  let next = 0;
  for (const word of whole) if (word === part[next]) next += 1;
  return next === part.length;
}

/**
 * The minifier merges longhands into their shorthand (`margin-top` into
 * `margin`, `border-top-color` into `border-color`, `top` into `inset`), so a
 * property counts as kept when it or a shorthand or longhand of it survives.
 */
function isKept(property: string, kept: ReadonlySet<string>): boolean {
  const words = wordsOf(property);
  return [...kept].some((candidate) => {
    const other = wordsOf(candidate);
    return other[0] === words[0] && (isSubsequence(other, words) || isSubsequence(words, other));
  });
}

/** Every keyframe property the source sets and the production Tailwind step drops. */
async function keyframesLostInBuild(source: string): Promise<string[]> {
  // What @tailwindcss/postcss does under NODE_ENV=production: compile with every
  // polyfill, then optimize and minify with Lightning CSS.
  const compiler = await compile(source, { base: appDirectory, onDependency: () => {} });
  const built = keyframeBlocks(optimize(compiler.build([]), { minify: true }).code);
  const lost: string[] = [];
  for (const [key, frames] of keyframeBlocks(source)) {
    for (const [offset, properties] of frames) {
      const kept = built.get(key)?.get(offset) ?? new Set<string>();
      for (const property of properties) {
        if (!isKept(property, kept)) lost.push(`${key} ${offset} { ${property} }`);
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
  // and an emptied block whose healthy namesake sits under another condition.
  const emptied = `@import 'tailwindcss' source(none);
:root { --success: #15803d; }
@keyframes green-glow {
  0%, 100% { filter: drop-shadow(0 0 12px color-mix(in oklab, var(--success) 35%, transparent)); }
  50% { filter: drop-shadow(0 0 22px color-mix(in oklab, var(--success) 55%, transparent)); }
}
@keyframes glow { 50% { background-color: color-mix(in oklab, var(--success) 50%, transparent); } }
@media (prefers-reduced-motion: reduce) {
  @keyframes glow { 50% { background-color: var(--success); } }
}`;
  expect(await keyframesLostInBuild(emptied)).toEqual([
    '@keyframes green-glow#0 0% { filter }',
    '@keyframes green-glow#0 100% { filter }',
    '@keyframes green-glow#0 50% { filter }',
    '@keyframes glow#0 50% { background-color }',
  ]);
});

test('the keyframe check accepts what the minifier only rewrites', async () => {
  const rewritten = `@import 'tailwindcss' source(none);
@keyframes rewritten {
  50.00% { margin-top: 1px; margin-right: 1px; margin-bottom: 1px; margin-left: 1px; }
  from { top: 0; right: 0; bottom: 0; left: 0; }
  to { border-top-color: red; border-right-color: red; border-bottom-color: red; border-left-color: red; }
}`;
  expect(await keyframesLostInBuild(rewritten)).toEqual([]);
});
