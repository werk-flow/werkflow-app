import { describe, expect, test } from 'bun:test';
import { newRunSalt } from './column-statistics';
import { buildRowTable } from './table-builder';

const rows = (first: string): { text: string }[][] =>
  [
    [first, 'Ventil undicht'],
    ['12', 'Thermostat tauschen'],
    ['24', 'Pumpe läuft laut'],
  ].map((row) => row.map((text) => ({ text })));

describe('header detection', () => {
  test.each(['-', 'k.A.', 'k. A.', 'K.A.', 'n/a', 'N / A', 'n.v.', 'N.N.', 'keine', 'fehlt', '?'])(
    'a placeholder (%s) above a number column keeps positional column names',
    (placeholder) => {
      const table = buildRowTable(rows(placeholder), { salt: newRunSalt(), detectHeader: true });
      expect(table.header).toBe('none detected');
      expect(table.columns.map((column) => column.name)).toEqual(['column_1', 'column_2']);
    },
  );

  test('a word above a number column names the columns', () => {
    const table = buildRowTable(rows('Nr'), { salt: newRunSalt(), detectHeader: true });
    expect(table.header).toBe('first row');
    expect(table.rows).toBe(2);
  });
});
