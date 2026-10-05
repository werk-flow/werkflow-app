import { expect, test } from 'bun:test';
import { isServerRow, withPendingDraft } from './pending-drafts';

test('server identity reconciles a draft without hiding a different same-name location', () => {
  const existing = { id: 'other-parent', name: 'Regal' };
  const draft = { confirmedId: 'new-location', name: 'Regal' };
  expect(withPendingDraft([existing], draft)).toEqual([draft, existing]);
  const saved = { id: 'new-location', name: 'Regal' };
  expect(withPendingDraft([existing, saved], draft)).toEqual([existing, saved]);
});

test('an unresolved creation remains pending until its returned identity is known', () => {
  const saved = { id: 'new-location', name: 'Regal' };
  expect(withPendingDraft([saved], { confirmedId: null, name: 'Regal' })).toHaveLength(2);
  expect(withPendingDraft([saved], { confirmedId: saved.id, name: 'Regal' })).toEqual([saved]);
});

test('pending identities stay separate from server row identities', () => {
  expect(isServerRow({ name: 'Regal', confirmedId: 'saved' })).toBe(false);
  expect(isServerRow({ name: 'Regal', id: 'saved' })).toBe(true);
  // @ts-expect-error A pending draft cannot masquerade as a server row.
  withPendingDraft([], { name: 'Regal', confirmedId: null, id: 'client-id' });
});
