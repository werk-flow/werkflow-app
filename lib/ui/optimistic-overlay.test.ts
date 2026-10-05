import { expect, test } from 'bun:test';
import { expireOptimisticOverlay, type OptimisticOverlayEntry } from './optimistic-overlay';

type Row = { id: string; name: string; updatedAt: string };
const getId = (row: Row): string => row.id;
const stored: Row = { id: 'a', name: 'Alt', updatedAt: '2026-10-01T08:00:00Z' };
const echo: Row = { ...stored, name: 'Neu' };
const overlayOf = (entries: Array<[string, OptimisticOverlayEntry<Row>]>) => new Map(entries);

test('an update echo stays while the list does not carry every echoed field', () => {
  const overlay = overlayOf([['a', { kind: 'update', item: echo, previous: stored }]]);
  expect(expireOptimisticOverlay(overlay, [stored], getId)).toBe(overlay);
  // The saved row carries a server-set field the echo could not predict.
  expect(expireOptimisticOverlay(overlay, [{ ...echo, updatedAt: '2026-10-01T09:00:00Z' }], getId)).toBe(
    overlay,
  );
  expect(expireOptimisticOverlay(overlay, [echo], getId).size).toBe(0);
});

test('a settled update leaves with the next authoritative list although a server-set field differs', () => {
  const overlay = overlayOf([['a', { kind: 'update', item: echo, previous: stored, settled: true }]]);
  expect(expireOptimisticOverlay(overlay, [{ ...echo, updatedAt: '2026-10-01T09:00:00Z' }], getId).size).toBe(
    0,
  );
});

test('a settled insert under a temporary id leaves with the next list, an unsettled one waits for its id', () => {
  const draft: Row = { id: 'temp', name: 'Neu', updatedAt: '' };
  const pending = overlayOf([['temp', { kind: 'insert', item: draft, tempId: 'temp' }]]);
  expect(expireOptimisticOverlay(pending, [stored], getId)).toBe(pending);
  expect(expireOptimisticOverlay(pending, [stored, draft], getId).size).toBe(0);
  const settled = overlayOf([['temp', { kind: 'insert', item: draft, tempId: 'temp', settled: true }]]);
  expect(expireOptimisticOverlay(settled, [stored, { ...draft, id: 'server-id' }], getId).size).toBe(0);
});

test('a remove leaves when the row is gone and only the confirmed entries leave', () => {
  const overlay = overlayOf([
    ['a', { kind: 'remove', previous: stored }],
    ['b', { kind: 'update', item: { ...stored, id: 'b', name: 'Neu' }, previous: { ...stored, id: 'b' } }],
  ]);
  expect(expireOptimisticOverlay(overlay, [stored, { ...stored, id: 'b' }], getId)).toBe(overlay);
  expect([...expireOptimisticOverlay(overlay, [{ ...stored, id: 'b' }], getId).keys()]).toEqual(['b']);
});
