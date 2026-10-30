import { describe, expect, test } from 'bun:test';
import { ColumnAccumulator, newRunSalt } from './column-statistics';
import { findRelations } from './relations';

describe('column statistics', () => {
  test('values that differ only in leading zeros stay distinct', () => {
    const column = new ColumnAccumulator('Nr', newRunSalt());
    for (const value of ['1', '01', '001']) column.add(value);
    expect(column.profile(3)).toMatchObject({ distinct: 3, unique: true });
  });

  test('two tables with the same shown label are still compared with each other', () => {
    const salt = newRunSalt();
    const key = new ColumnAccumulator('KdNr', salt);
    const reference = new ColumnAccumulator('Kunde', salt);
    for (const value of ['10001', '10002', '10003']) {
      key.add(value);
      reference.add(value);
    }
    const columnOf = (accumulator: ColumnAccumulator) => ({
      label: 'XxXx',
      accumulator,
      type: 'integer' as const,
      keyLike: true,
      maxLength: 5,
    });
    const relations = findRelations([
      { id: 0, table: 'Xxxxxx.xxx', columns: [columnOf(key)] },
      { id: 1, table: 'Xxxxxx.xxx', columns: [columnOf(reference)] },
    ]);
    expect(relations).toHaveLength(2);
  });
});
