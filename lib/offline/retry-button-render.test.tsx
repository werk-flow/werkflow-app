import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RetryButton } from '@/app/offline/retry-button';

// Rule test: on a phone where the offline page's script cannot run, „Erneut
// versuchen“ in the prerendered HTML must still reload the address the person
// opened. It was disabled until hydration, so it did nothing at all
// (werk-flow/werkflow-planning#22, the 2026-11-14 iPhone re-test).
test('the prerendered retry is an enabled submit of a form that reloads the opened address', () => {
  const markup = renderToStaticMarkup(createElement(RetryButton));
  const form = markup.match(/^<form[^>]*>/)?.[0] ?? '';
  expect(form).toContain(' method="get"');
  // Without an action the form reloads the document's own address.
  expect(form).not.toContain(' action=');
  const button = markup.match(/<button[^>]*>/)?.[0] ?? '';
  expect(button).toContain(' type="submit"');
  // The attribute, not the `disabled:` style variants in its class.
  expect(button).not.toMatch(/\sdisabled(?:[=\s>]|$)/);
});
