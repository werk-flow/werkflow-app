import { expect, test } from 'bun:test';
import { CLOUD_SECURITY_QUERY, getDevSecurityProblems } from './cloud-security';

async function withResponse(response: Response): Promise<string[]> {
  const previous = process.env.SUPABASE_ACCESS_TOKEN;
  process.env.SUPABASE_ACCESS_TOKEN = 'synthetic-metadata-token';
  try {
    const request = Object.assign(async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      expect(String(url)).toBe('https://api.supabase.com/v1/projects/mbkkzuqjbdvzelqvuzcn/database/query');
      expect(init?.redirect).toBe('error');
      expect(JSON.parse(String(init?.body)).query).toBe(CLOUD_SECURITY_QUERY);
      return response;
    }, { preconnect: fetch.preconnect });
    return await getDevSecurityProblems(request);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = previous;
  }
}

test('cloud grant drift is returned as a failure, not discarded by a local catalog check', async () => {
  expect(await withResponse(Response.json([{ problem: 'public.unsafe: client definer grant' }], { status: 201 })))
    .toEqual(['public.unsafe: client definer grant']);
  expect(await withResponse(Response.json([], { status: 201 }))).toEqual([]);
});

test('unavailable or malformed provider evidence cannot be interpreted as clean grants', async () => {
  await expect(withResponse(new Response('sensitive provider body', { status: 503 })))
    .rejects.toThrow('DEV security metadata query returned HTTP 503.');
  await expect(withResponse(Response.json({ result: [] }, { status: 201 }))).rejects.toThrow();
});
