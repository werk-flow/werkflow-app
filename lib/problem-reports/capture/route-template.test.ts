import { expect, test } from 'bun:test';
import { routeTemplate } from './route-template';

test('a route param becomes its name, so no record number travels in a report', () => {
  expect(routeTemplate('/auftraege/AUF-2026-001', { jobNumber: 'AUF-2026-001' })).toBe(
    '/auftraege/[jobNumber]',
  );
  expect(routeTemplate('/kunden/M%C3%BCller', { clientId: 'Müller' })).toBe('/kunden/[clientId]');
});

test('a segment no param names becomes [wert] unless it is a plain route word', () => {
  expect(routeTemplate('/dokumente/0f5c2f3e-1111-4a4a-8b8b-123456789abc/neu', {})).toBe(
    '/dokumente/[wert]/neu',
  );
  expect(routeTemplate('/kunden/Erika%20Musterfrau', {})).toBe('/kunden/[wert]');
  expect(routeTemplate('/zeiterfassung/zeitkonto', {})).toBe('/zeiterfassung/zeitkonto');
});

test('the start page is its own template', () => {
  expect(routeTemplate('/', {})).toBe('/');
});
