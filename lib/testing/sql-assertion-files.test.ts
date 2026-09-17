import { expect, test } from 'bun:test';
import { executeSqlAssertionFiles } from './sql-assertion-files';

test('multiple SQL files finish in declared order, including the second file', async () => {
  const events: string[] = [];
  await executeSqlAssertionFiles(['first.sql', 'second.sql'], async (file) => {
    events.push(`start:${file}`);
    await Promise.resolve();
    events.push(`finish:${file}`);
  });
  expect(events).toEqual(['start:first.sql', 'finish:first.sql', 'start:second.sql', 'finish:second.sql']);
});

test('an unsuccessful later SQL file fails the group and prevents following sessions', async () => {
  const visited: string[] = [];
  await expect(executeSqlAssertionFiles(['first.sql', 'second.sql', 'third.sql'], async (file) => {
    visited.push(file);
    if (file === 'second.sql') throw new Error('assertion failed');
  })).rejects.toThrow('assertion failed');
  expect(visited).toEqual(['first.sql', 'second.sql']);
});
