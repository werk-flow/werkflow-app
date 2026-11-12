import { createServerClient } from '@supabase/ssr';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { resolve } from 'node:path';
import { workspaceAppOrigin } from '../../../lib/testing/runner/app-port';
import { TEST_SUPPORT_USER, type TestSupportUser } from '../../../lib/testing/support-user';
import { testSupabaseClientOptions } from './client-options';
import { ensureSupportUserLink } from './db/problem-reports';
import { requireEnv } from './env';
import { openPage } from './streamed-content';

// The session of WerkFlow support in a browser test: a synthetic user the
// test server's allowlist names (lib/testing/support-user.ts), a member of no
// organization. It lives beside sessions.ts, not in it: every measured
// scenario's digest covers that file, and a support session measures nothing.

/**
 * Signs the support user into a browser context. The account has no
 * password: the Auth admin API issues a one-time link whose token the
 * context's own client redeems, so every context owns its session.
 */
export async function signInSupportUser(
  context: BrowserContext,
  baseUrl: string,
  user: TestSupportUser = TEST_SUPPORT_USER,
): Promise<void> {
  const origin = new URL(baseUrl);
  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      global: { ...testSupabaseClientOptions.global },
      cookies: {
        getAll: async () => context.cookies(baseUrl),
        setAll: async (updates) => {
          await context.addCookies(
            updates.map(({ name, value, options }) => ({
              name,
              value,
              domain: origin.hostname,
              path: options.path ?? '/',
              httpOnly: options.httpOnly ?? false,
              secure: origin.protocol === 'https:',
              sameSite:
                options.sameSite === 'strict' ? 'Strict' : options.sameSite === 'none' ? 'None' : 'Lax',
              ...(options.maxAge !== undefined
                ? { expires: options.maxAge <= 0 ? 0 : Math.floor(Date.now() / 1000) + options.maxAge }
                : {}),
            })),
          );
        },
      },
    },
  );
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: await ensureSupportUserLink(user),
    type: 'email',
  });
  if (error || data.user?.id !== user.id || !data.session)
    throw new Error(`Test session setup failed for support: ${error?.code ?? 'identity_mismatch'}`);
}

/** A page of WerkFlow support in a context of its own; the caller closes the context. */
export async function createSupportPage(input: {
  browser: Browser;
  baseUrl?: string | undefined;
  user?: TestSupportUser;
}): Promise<{ context: BrowserContext; page: Page }> {
  const baseUrl = input.baseUrl ?? workspaceAppOrigin(resolve(__dirname, '../../..'));
  const context = await input.browser.newContext({
    baseURL: baseUrl,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  try {
    await signInSupportUser(context, baseUrl, input.user);
    return { context, page: await openPage(context) };
  } catch (error) {
    await context.close();
    throw error;
  }
}
