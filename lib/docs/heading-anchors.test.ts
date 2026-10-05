import { expect, test } from 'bun:test';
import { markdownHeadingAnchors } from './heading-anchors';

test('heading anchors preserve identifiers and remove formatting', () => {
  expect([
    ...markdownHeadingAnchors(
      '# `foo_bar`\n# foo_bar\n## _Emphasis_ and **strong**\n## [A link](file.md) ###',
    ),
  ]).toEqual(['foo_bar', 'foo_bar-1', 'emphasis-and-strong', 'a-link']);
});

test('fenced examples cannot supply real document anchors', () => {
  expect([
    ...markdownHeadingAnchors(
      '```md\n# Fake\n<a id="fake"></a>\n```\n~~~\n## Also fake\n~~~\n# Real\n<a id="explicit"></a>',
    ),
  ]).toEqual(['real', 'explicit']);
});
