import { expect, test } from 'bun:test';
import { runWithLogCleanup } from './command-log';

test('a failed log flush cannot replace the original command failure', async () => {
  const commandError = new Error('WSL lease lost during the command');
  const logError = new Error('Log device unavailable');
  const secondary: unknown[] = [];
  await expect(runWithLogCleanup({
    command: async () => { throw commandError; },
    closeLog: async () => { throw logError; },
    reportSecondaryFailure: (error) => { secondary.push(error); },
  })).rejects.toBe(commandError);
  expect(secondary).toEqual([logError]);
});

test('a standalone log flush failure still fails an otherwise successful command', async () => {
  const logError = new Error('Log device unavailable');
  await expect(runWithLogCleanup({
    command: async () => 0,
    closeLog: async () => { throw logError; },
    reportSecondaryFailure: () => { throw new Error('Not a secondary error'); },
  })).rejects.toBe(logError);
});

test('successful cleanup preserves the command result', async () => {
  let closed = false;
  expect(await runWithLogCleanup({
    command: async () => 23,
    closeLog: async () => { closed = true; },
    reportSecondaryFailure: () => { throw new Error('Unexpected error report'); },
  })).toBe(23);
  expect(closed).toBe(true);
});
