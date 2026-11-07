import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import type { AuthUrlFixtureName } from './auth-url-boundaries';
import { CONTRACT_SESSION_COOKIE, CONTRACT_SUPABASE_URL } from './supabase-contract-env';

const STORED_ACCOUNT = '00000000-0000-4000-8000-000000000001';
const LINKED_ACCOUNT = '00000000-0000-4000-8000-000000000002';
/** An unsigned token shaped like an Auth access token; the client reads its expiry and subject. */
function accessToken(account: string): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = {
    sub: account,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.${part({ unsigned: true })}`;
}

/** Tokens of another account in the fragment of a link to an ordinary page. */
function tokenFragment(): string {
  return `#access_token=${accessToken(LINKED_ACCOUNT)}&refresh_token=linked-refresh&expires_in=3600&token_type=bearer&type=recovery`;
}

function storedSessionCookie(): string {
  const session = {
    access_token: accessToken(STORED_ACCOUNT),
    refresh_token: 'stored-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: STORED_ACCOUNT,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

/** The account a bearer token names, as Auth would answer `/user` for it. */
function bearerAccount(authorization: string | undefined): string | null {
  const payload = authorization?.replace(/^Bearer /, '').split('.')[1];
  if (!payload) return null;
  const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return typeof claims === 'object' && claims !== null && 'sub' in claims && typeof claims.sub === 'string'
    ? claims.sub
    : null;
}

/**
 * Opens the fixture on a URL whose fragment carries tokens and returns every
 * Auth request that used the link's credentials. Auth answers each token for
 * its own account, so a client that redeems the link signs in as the linked
 * account, while a check of the stored session stays allowed.
 */
async function openWithTokenLink(
  page: Page,
  fixture: AuthUrlFixtureName,
  { storedSession }: { storedSession: boolean },
): Promise<string[]> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  const linkedCredentialUses: string[] = [];
  await page.route(`${CONTRACT_SUPABASE_URL}/**`, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const account = bearerAccount(request.headers()['authorization']);
    if (account === LINKED_ACCOUNT || (request.postData() ?? '').includes('linked-refresh')) {
      linkedCredentialUses.push(path);
    }
    if (path === '/auth/v1/user' && account) {
      return route.fulfill({
        json: {
          id: account,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-01-01T00:00:00.000Z',
        },
      });
    }
    return route.fulfill({ status: 400, json: { error: 'invalid_grant' } });
  });
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  if (storedSession) {
    await page
      .context()
      .addCookies([{ name: CONTRACT_SESSION_COOKIE, value: storedSessionCookie(), url: 'http://localhost' }]);
  }
  await page.goto(`http://localhost/ui-contracts${tokenFragment()}`);
  await page.evaluate((name) => {
    window.uiContractFixture = name;
  }, fixture);
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('heading', { name: 'Komponentenverträge' })).toBeVisible();
  return linkedCredentialUses;
}

async function sessionCookieNames(page: Page): Promise<string[]> {
  const cookies = await page.context().cookies('http://localhost');
  return cookies.map((cookie) => cookie.name).filter((name) => name.startsWith(CONTRACT_SESSION_COOKIE));
}

test('tokens in a link to an ordinary page neither sign in nor sign out the stored account', async ({
  page,
}) => {
  const linkedCredentialUses = await openWithTokenLink(page, 'auth-url-session', { storedSession: true });
  await expect(page.getByLabel('Angemeldetes Konto')).toHaveText(STORED_ACCOUNT);
  expect(await sessionCookieNames(page)).toEqual([CONTRACT_SESSION_COOKIE]);
  expect(linkedCredentialUses).toEqual([]);
});

test('the reset page signs nobody in from tokens in its link', async ({ page }) => {
  const linkedCredentialUses = await openWithTokenLink(page, 'auth-url-reset-form', { storedSession: false });
  await expect(page.getByRole('link', { name: 'Neuen Link anfordern' })).toBeVisible();
  await expect(page.getByLabel('Neues Passwort')).toHaveCount(0);
  expect(await sessionCookieNames(page)).toEqual([]);
  expect(linkedCredentialUses).toEqual([]);
});
