// Rule test: the next/font variables sit on <html>, so the Tailwind font tokens resolve to Geist.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tailwind declares --font-sans: var(--font-geist-sans) on :root. With the
// variable classes on <body>, :root could not resolve it, and every page fell
// back to the platform's system-ui font instead of Geist (owner decision of
// 2026-10-25). The browser half of this rule is the computed-font check of
// every visual reference (tests/audit/support/visual-references.ts).
const layout = readFileSync(resolve(import.meta.dir, '../../app/layout.tsx'), 'utf8');

test('the root layout puts both font variables on <html> and none on <body>', () => {
  const html = /<html\s[^>]*>/.exec(layout)?.[0] ?? '';
  const body = /<body\s[^>]*>/.exec(layout)?.[0] ?? '';
  expect(html).toContain('geistSans.variable');
  expect(html).toContain('geistMono.variable');
  expect(body).not.toContain('.variable');
});

test('the theme maps the sans and mono tokens to the next/font variables', () => {
  const css = readFileSync(resolve(import.meta.dir, '../../app/globals.css'), 'utf8');
  expect(css).toContain('--font-sans: var(--font-geist-sans);');
  expect(css).toContain('--font-mono: var(--font-geist-mono);');
});
