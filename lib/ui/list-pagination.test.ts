import { describe, expect, test } from 'bun:test';
import { lastListPage, parseListPage } from './list-pagination';

describe('list page boundaries', () => {
  test('invalid and fractional page input cannot create negative query offsets', () => {
    for (const value of [undefined, '', 'no', '-1', '0', '1.5', 'Infinity']) expect(parseListPage(value)).toBe(1);
    expect(parseListPage('23')).toBe(23);
    expect(parseListPage('999999999')).toBe(1_000_000);
  });
  test('empty and partial last pages remain navigable', () => {
    expect(lastListPage(0)).toBe(1);
    expect(lastListPage(50)).toBe(1);
    expect(lastListPage(51)).toBe(2);
  });
});
