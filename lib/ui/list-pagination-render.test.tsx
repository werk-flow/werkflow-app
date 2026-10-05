import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ListPagination } from '@/components/shared/list-pagination';

// Under an empty list the EmptyState speaks alone, and a single page needs no
// page buttons: the service lists showed „0 von 0 · Zurück · Seite 1 von 1 ·
// Weiter“ under „Keine Anlagen gefunden“ (rendered review of 2026-10-02).

const render = (page: number, total: number): string =>
  renderToStaticMarkup(
    createElement(ListPagination, { page, total, label: 'Liste', onPageChange: () => {} }),
  );

test('an empty list renders no pagination', () => {
  expect(render(1, 0)).toBe('');
});

test('a single page shows its count without page buttons', () => {
  const markup = render(1, 7);
  expect(markup).toContain('1–7');
  expect(markup).not.toContain('Weiter');
});

test('several pages, and a page past the end, keep the page buttons', () => {
  expect(render(1, 61)).toContain('Weiter');
  expect(render(3, 7)).toContain('Seite nicht mehr vorhanden');
});
