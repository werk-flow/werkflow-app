import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { fetchCustomerPage } from './list-page';

test('customer page GET exercises current authorization and the shared bounded reader', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/customer-page-http.ts')], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});

test('customer page transport retains cancellation and rejects malformed or foreign rows', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const organizationId = '10000000-0000-4000-8000-000000000001';
  let body: unknown = { clients: [], total: 61 };
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    expect(new URL(String(input), 'http://localhost').searchParams.get('search')).toBe('Kontakt & Ort');
    expect(init?.signal).toBe(controller.signal);
    expect(init?.cache).toBe('no-store');
    return Response.json(body);
  }, { preconnect: originalFetch.preconnect });
  try {
    const input = { organizationId, page: 2, search: 'Kontakt & Ort' };
    expect(await fetchCustomerPage(input, controller.signal)).toEqual({ clients: [], total: 61 });
    body = { clients: [], total: -1 };
    await expect(fetchCustomerPage(input, controller.signal)).rejects.toThrow();
    body = { clients: [{ id: organizationId, organizationId: '10000000-0000-4000-8000-000000000002', name: 'Foreign', clientType: 'privat', customerNumber: null, email: null, phone: null, address: null, notes: null, createdAt: '', updatedAt: '' }], total: 1 };
    await expect(fetchCustomerPage(input, controller.signal)).rejects.toThrow('customer_page_scope_changed');
  } finally { globalThis.fetch = originalFetch; }
});
