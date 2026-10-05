import { createServerClient } from '@supabase/ssr';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { requireEnv } from './env';
import { testSupabaseClientOptions } from './client-options';
import type { TestRole, TestWorld } from './world';

export type SessionRole = TestRole | 'outsider';

/** Each browser context owns a real session. Refresh tokens are never cloned between contexts. */
export async function createRolePage(input: {
  browser: Browser;
  baseUrl?: string | undefined;
  world: TestWorld;
  role: SessionRole;
}): Promise<{ context: BrowserContext; page: Page }> {
  const user = input.role === 'outsider' ? input.world.outsider.admin : input.world.users[input.role];
  const organizationId = input.role === 'outsider' ? input.world.outsider.orgId : input.world.orgId;
  const baseUrl = input.baseUrl ?? process.env.GOLDEN_BASE_URL ?? 'http://localhost:3000';
  const origin = new URL(baseUrl);
  const context = await input.browser.newContext({
    baseURL: baseUrl,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  try {
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });
    if (error || data.user?.id !== user.id || !data.session) {
      throw new Error(`Test session setup failed for ${input.role}: ${error?.code ?? 'identity_mismatch'}`);
    }
    // This is a selected-organization hint, not authorization. The app still checks membership.
    await context.addCookies([
      {
        name: 'current_org_id',
        value: organizationId,
        url: origin.origin,
        sameSite: 'Lax',
        httpOnly: true,
        secure: origin.protocol === 'https:',
      },
    ]);
    return { context, page: await context.newPage() };
  } catch (error) {
    try {
      await context.close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Test session setup and browser cleanup failed.');
    }
    throw error;
  }
}
