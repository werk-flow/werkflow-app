import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import type { RequestPriority } from '@/lib/supabase/request-scheduler';
import { logError } from '@/lib/logging';

const readRequests = new AsyncLocalStorage<{ signal: AbortSignal; priority: RequestPriority }>();

/** GET-only lifetime. Every invocation, including a nested one, starts a fresh scope. */
export function withReadRequest<Result>(
  request: Request,
  read: () => Promise<Result>,
  options: { priority?: RequestPriority } = {},
): Promise<Result> {
  if (request.method !== 'GET') throw new Error('Read-request memoization requires GET.');
  return readRequests.run({ signal: request.signal, priority: options.priority ?? 'foreground' }, read);
}

export function getReadRequestPriority(): RequestPriority {
  return readRequests.getStore()?.priority ?? 'foreground';
}

/** Cancellation belongs to this GET only; mutations never inherit a read signal. */
export function getReadRequestSignal(): AbortSignal | undefined {
  return readRequests.getStore()?.signal;
}

/**
 * A discarded GET is not a failed save. Keep failures visible outside that
 * exact request, by classification only (lib/logging.ts).
 */
export function logReadFailure(message: string, error: unknown): void {
  if (getReadRequestSignal()?.aborted) return;
  logError(message, error);
}

/**
 * Logs the first present error of a failed read, by code only. A call without
 * an error (a plain "not found") and the empty result of `.single()` log nothing.
 */
export function logReadErrors(
  label: string,
  ...errors: ReadonlyArray<{ code?: string } | null | undefined>
): void {
  const error = errors.find((candidate) => candidate && candidate.code !== 'PGRST116');
  if (error) logReadFailure(label, { code: error.code ?? 'unknown' });
}

/**
 * Passes a query result through and logs its error, so "not found" and "the
 * read failed" stay apart in the logs where the caller treats both alike.
 * `ignoreNoRow` is for `.single()`, whose empty result is an error by design.
 */
export async function loggedRead<Result extends { error: { code?: string } | null }>(
  label: string,
  query: PromiseLike<Result>,
  ignoreNoRow = false,
): Promise<Result> {
  const result = await query;
  if (ignoreNoRow) logReadErrors(label, result.error);
  else if (result.error) logReadFailure(label, { code: result.error.code ?? 'unknown' });
  return result;
}

/**
 * React memoization does not run in route handlers. Share in-flight reads only
 * inside an explicit GET scope; preserve React's behavior everywhere else.
 * Each reader owns a typed WeakMap, so caller data cannot outlive its scope.
 */
export function memoizeRequestRead<Arguments extends readonly string[], Result>(
  read: (...args: Arguments) => Promise<Result>,
  options: { outsideRequest?: 'render' | 'fresh' } = {},
): (...args: Arguments) => Promise<Result> {
  const renderRead = cache(read);
  const values = new WeakMap<object, Map<string, Promise<Result>>>();
  return (...args: Arguments): Promise<Result> => {
    const scope = readRequests.getStore();
    if (!scope) return options.outsideRequest === 'fresh' ? read(...args) : renderRead(...args);
    let entries = values.get(scope);
    if (!entries) {
      entries = new Map();
      values.set(scope, entries);
    }
    const key = JSON.stringify(args);
    const existing = entries.get(key);
    if (existing) return existing;
    const pending = read(...args);
    entries.set(key, pending);
    return pending;
  };
}
