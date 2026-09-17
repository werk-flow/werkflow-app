import { expect, test } from 'bun:test';
import { createTransportDiagnosticFetch, type TransportDiagnostic } from './transport-diagnostics';

test('a rejected POST is attempted once and preserves its error and request inputs', async () => {
  const cause = Object.assign(new Error('private host and token'), { code: 'EACCES', syscall: 'connect', address: 'private address' });
  const failure = new TypeError('fetch failed', { cause });
  const records: TransportDiagnostic[] = [];
  const input = 'https://user:password@example.test/private-person?token=secret';
  const init: RequestInit = { method: 'POST', body: 'private payload', headers: { authorization: 'secret' } };
  let calls = 0;
  const fetch = createTransportDiagnosticFetch({
    fetchImplementation: async (receivedInput: RequestInfo | URL, receivedInit?: RequestInit) => {
      calls += 1;
      expect(receivedInput).toBe(input);
      expect(receivedInit).toBe(init);
      throw failure;
    },
    record: (record) => { records.push(record); },
  });
  await expect(fetch(input, init)).rejects.toBe(failure);
  expect(calls).toBe(1);
  expect(records).toEqual([{
    event: 'test-fetch-rejected', method: 'POST', origin: 'https://example.test',
    errors: [{ depth: 0, name: 'TypeError' }, { depth: 1, name: 'Error', code: 'EACCES', syscall: 'connect' }],
  }]);
});

test('HTTP errors remain the identical unread response and are never retried or reported', async () => {
  for (const status of [200, 401, 429, 503]) {
    const response = new Response('body remains available', { status });
    let calls = 0;
    let reports = 0;
    const fetch = createTransportDiagnosticFetch({
      fetchImplementation: async () => { calls += 1; return response; },
      record: () => { reports += 1; },
    });
    expect(await fetch(new URL('https://example.test/private'))).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe('body remains available');
    expect(calls).toBe(1);
    expect(reports).toBe(0);
  }
});

test('abort identity and Request method survive diagnostic recorder failure', async () => {
  const failure = new DOMException('private abort reason', 'AbortError');
  const request = new Request('https://example.test/private', { method: 'DELETE' });
  const records: TransportDiagnostic[] = [];
  for (const asyncRecorder of [false, true]) {
    const fetch = createTransportDiagnosticFetch({
      fetchImplementation: async (input: RequestInfo | URL) => { expect(input).toBe(request); throw failure; },
      record: (record) => {
        records.push(record);
        if (asyncRecorder) return Promise.reject(new Error('recorder unavailable'));
        throw new Error('recorder unavailable');
      },
    });
    await expect(fetch(request)).rejects.toBe(failure);
  }
  expect(records.map(({ method, errors }) => ({ method, errors }))).toEqual([
    { method: 'DELETE', errors: [{ depth: 0, name: 'AbortError' }] },
    { method: 'DELETE', errors: [{ depth: 0, name: 'AbortError' }] },
  ]);
});

test('nested aggregate diagnostics are bounded, cycle-safe and omit arbitrary error fields', async () => {
  const privateFailure = { name: 'private person', code: 'EMPLOYEE_PRIVATE_TOKEN', syscall: '/private/path', message: 'private message' };
  const nested = Object.assign(new Error('private nested message'), { code: 'ECONNREFUSED', syscall: 'connect' });
  const failure = new AggregateError([privateFailure, nested, ...Array.from({ length: 30 }, () => new Error('private'))], 'private');
  failure.cause = failure;
  const records: TransportDiagnostic[] = [];
  const fetch = createTransportDiagnosticFetch({
    fetchImplementation: async () => { throw failure; },
    record: (record) => { records.push(record); },
  });
  await expect(fetch('not a URL containing private data', { method: 'private-method' })).rejects.toBe(failure);
  expect(records[0]?.origin).toBeNull();
  expect(records[0]?.method).toBe('OTHER');
  expect(records[0]?.errors).toHaveLength(8);
  expect(records[0]?.errors.slice(0, 3)).toEqual([
    { depth: 0, name: 'AggregateError' },
    { depth: 1, name: 'UnknownError' },
    { depth: 1, name: 'Error', code: 'ECONNREFUSED', syscall: 'connect' },
  ]);
  expect(JSON.stringify(records)).not.toContain('private');
  expect(JSON.stringify(records)).not.toContain('EMPLOYEE_PRIVATE_TOKEN');
});

test('a pending asynchronous recorder cannot delay the original fetch rejection', async () => {
  const failure = new TypeError('fetch failed');
  const fetch = createTransportDiagnosticFetch({
    fetchImplementation: async () => { throw failure; },
    record: () => new Promise<void>(() => {}),
  });
  await expect(fetch('https://example.test')).rejects.toBe(failure);
});

test('cause depth and throwing metadata getters cannot replace the original rejection', async () => {
  let failure = new Error('private');
  for (let index = 0; index < 20; index += 1) failure = new Error('private', { cause: failure });
  Object.defineProperty(failure, 'code', { get: () => { throw new Error('getter failed'); } });
  const records: TransportDiagnostic[] = [];
  const fetch = createTransportDiagnosticFetch({
    fetchImplementation: async () => { throw failure; },
    record: (record) => { records.push(record); },
  });
  await expect(fetch('https://example.test')).rejects.toBe(failure);
  expect(records[0]?.errors.map(({ depth }) => depth)).toEqual([0, 1, 2, 3, 4]);
});

test('the wrapper transparently delegates callable properties and the original call receiver', async () => {
  const response = new Response('unchanged');
  const receiver = { marker: 'original receiver' };
  const preconnectCalls: string[] = [];
  const implementation = Object.assign(async function (this: unknown): Promise<Response> {
    expect(this).toBe(receiver);
    return response;
  }, {
    preconnect: (origin: string): void => { preconnectCalls.push(origin); },
    transportName: 'injected',
  });
  const wrapped = createTransportDiagnosticFetch({ fetchImplementation: implementation });
  expect(wrapped.preconnect).toBe(implementation.preconnect);
  wrapped.preconnect('https://example.test');
  expect(preconnectCalls).toEqual(['https://example.test']);
  implementation.transportName = 'updated';
  expect(wrapped.transportName).toBe('updated');
  expect(await wrapped.call(receiver, 'https://example.test')).toBe(response);
});
