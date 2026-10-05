import { afterEach, expect, spyOn, test } from 'bun:test';
import { logError } from './logging';

const consoleError = spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => consoleError.mockClear());

function logged(error: unknown): unknown {
  logError('label', error);
  return consoleError.mock.calls.at(-1)?.[1];
}

test('a Postgres or provider error is logged by name, code and status only', () => {
  const postgresError = {
    name: 'PostgrestError',
    code: '23505',
    message: 'duplicate key value violates unique constraint, Key (email)=(max@example.test)',
    details: 'Key (email)=(max@example.test) already exists.',
    hint: null,
    status: 409,
  };
  expect(logged(postgresError)).toEqual({ name: 'PostgrestError', code: '23505', status: 409 });
  const thrown = Object.assign(new Error('fetch failed for https://x.test/?email=max@example.test'), {
    code: 'ECONNRESET',
  });
  expect(logged(thrown)).toEqual({ name: 'Error', code: 'ECONNRESET' });
});

test('free text never reaches the log, while a stable code does', () => {
  expect(logged('time_correction_not_found')).toEqual({ code: 'time_correction_not_found' });
  expect(logged('Benutzer max@example.test nicht gefunden')).toEqual({ name: 'string' });
  expect(logged({ code: 'x'.repeat(200), name: 'contains spaces and @' })).toEqual({});
  expect(logged(undefined)).toEqual({});
  expect(logged(42)).toEqual({ name: 'number' });
});
