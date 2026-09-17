import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import type { RequestPriority } from '@/lib/supabase/request-scheduler';

const readRequests = new AsyncLocalStorage<{ signal: AbortSignal; priority: RequestPriority }>();

/** GET-only lifetime. Every invocation, including a nested one, starts a fresh scope. */
export function withReadRequest<Result>(request: Request, read: () => Promise<Result>, options: { priority?: RequestPriority } = {}): Promise<Result> {
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
