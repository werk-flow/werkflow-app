import { expect, spyOn, test } from 'bun:test';
import { getCalendarBoard, getCalendarWindow } from './client';

test('one calendar owner signal cancels both private fetch transports', async () => {
  const controller = new AbortController();
  const observed: Array<AbortSignal | null | undefined> = [];
  const cancelableFetch = Object.assign(
    (_request: Parameters<typeof fetch>[0], options?: RequestInit): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        observed.push(options?.signal);
        options?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        );
      }),
    { preconnect: globalThis.fetch.preconnect },
  );
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(cancelableFetch);
  try {
    const dates = { organizationId: 'contract-org', fromDate: '2026-09-08', toDate: '2026-09-09' };
    const reads = [
      getCalendarWindow(
        { ...dates, from: '2026-09-07T22:00:00Z', to: '2026-09-09T21:59:59Z' },
        controller.signal,
      ),
      getCalendarBoard(dates, controller.signal),
    ];
    expect(observed).toEqual([controller.signal, controller.signal]);
    controller.abort();
    expect(await Promise.all(reads)).toEqual([
      { success: false, error: 'calendar_read_failed' },
      { success: false, error: 'calendar_read_failed' },
    ]);
  } finally {
    controller.abort();
    fetchMock.mockRestore();
  }
});
