import { expect, test } from 'bun:test';
import { findDocCitations, isCitationCheckedFile } from './code-citations';

test('finds docs paths with their anchor and line', () => {
  const text = [
    '// See docs/technical/security.md#trust-boundaries for the rule.',
    "message: 'Read ../docs/technical/testing.md first.',",
    '// Not a citation: mydocs/notes.md, docs/...md',
  ].join('\n');
  expect(findDocCitations(text)).toEqual([
    { line: 1, path: 'docs/technical/security.md', anchor: 'trust-boundaries' },
    { line: 2, path: 'docs/technical/testing.md', anchor: null },
  ]);
});

test('captures an anchor with umlauts in full', () => {
  expect(findDocCitations('// docs/product/user-flow-catalog.md#aufträge-und-projekte.')).toEqual([
    { line: 1, path: 'docs/product/user-flow-catalog.md', anchor: 'aufträge-und-projekte' },
  ]);
});

test('skips docs, applied migrations and research transcripts', () => {
  expect(isCitationCheckedFile('lib/auth/identity-errors.ts')).toBe(true);
  expect(isCitationCheckedFile('eslint.config.mjs')).toBe(true);
  expect(isCitationCheckedFile('supabase/config.toml')).toBe(true);
  expect(isCitationCheckedFile('docs/technical/security.md')).toBe(false);
  expect(isCitationCheckedFile('supabase/migrations/20261001104036_limit.sql')).toBe(false);
  expect(isCitationCheckedFile('temporary-transcripts/README.md')).toBe(false);
  expect(isCitationCheckedFile('public/logo.svg')).toBe(false);
});
