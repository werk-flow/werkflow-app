// The invite step of the OTP sign-in against the real redemption route, with only the server's
// collaborators and the document load replaced: a `pending_invite_code` that is no code is refused
// by the route and lands on the invite error page. A plain string check would skip the redemption,
// and the form would open the app.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const loaded: string[] = [];

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ set: () => {} }) }));
mock.module('next/cache', () => ({ revalidateTag: () => {} }));
mock.module('@/lib/data/cached', () => ({ CACHE_TAGS: { memberCount: () => 'member-count' } }));
mock.module('@/lib/org/cookies', () => ({ CURRENT_ORG_COOKIE: 'current_org', CURRENT_ORG_MAX_AGE: 60 }));
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    throw new Error('a refused code never reaches the identity check');
  },
}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({}) }));
mock.module('@/lib/navigation/document-load', () => ({
  loadDocument: (url: string) => loaded.push(url),
}));

const { POST } = await import('@/app/api/redeem-invite/route');
const { redeemSignInInvite } = await import('@/components/otp-form-invite');

const sentBodies: string[] = [];

async function answer(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  assert.equal(String(input), '/api/redeem-invite');
  sentBodies.push(String(init?.body));
  return POST(
    new NextRequest('http://localhost/api/redeem-invite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        origin: 'http://localhost',
      },
      body: String(init?.body),
    }),
  );
}
globalThis.fetch = Object.assign(answer, { preconnect: globalThis.fetch.preconnect });

const supabase = createClient('http://localhost:54321', 'fixture-key', {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** The document a sign-in loads, or null when it carries no invite and the form opens the app. */
async function inviteLanding(metadata: Record<string, unknown>, inviteCode?: string): Promise<string | null> {
  loaded.length = 0;
  const left = await redeemSignInInvite(supabase, inviteCode, metadata);
  assert.equal(left, loaded.length === 1, 'the step reports whether it started a document load');
  return loaded[0] ?? null;
}

const INVITE_ERROR = '/invite-error?error=invalid_invite';

for (const pending_invite_code of [7, true, ['code'], { code: 'code' }, 'not-a-uuid']) {
  assert.equal(
    await inviteLanding({ pending_invite_code }),
    INVITE_ERROR,
    `${JSON.stringify(pending_invite_code)} is refused, not skipped`,
  );
}

// The code of the invite link goes first, whatever the metadata holds.
assert.equal(await inviteLanding({ pending_invite_code: 7 }, 'link-code'), INVITE_ERROR);
assert.equal(sentBodies.at(-1), JSON.stringify({ inviteCode: 'link-code' }));

// Without a value there is nothing to refuse.
for (const metadata of [{}, { pending_invite_code: null }, { pending_invite_code: '' }]) {
  assert.equal(await inviteLanding(metadata), null, `${JSON.stringify(metadata)} carries no invite`);
}
