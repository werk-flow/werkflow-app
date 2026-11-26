// A staging journey's browser loads staging's pages and a sandbox Checkout only, and the Vercel bypass
// reaches staging's host only. Every value here is made up.
import { describe, expect, test } from 'bun:test';

import { STAGING_ORIGIN, bypassHeaders, refusedOrigin, requestVerdict } from './boundary';

const SECRET = 'MadeUpBypassSecret0123456789abcd';
const page = (url: string) => ({ url, navigation: true, mainFrame: true });
const asset = (url: string) => ({ url, navigation: false, mainFrame: true });
const embedded = (url: string) => ({ url, navigation: true, mainFrame: false });

describe('origin refusal', () => {
  test('staging loads, as a page or an asset', () => {
    expect(requestVerdict(page(`${STAGING_ORIGIN}/dashboard`))).toBe('staging');
    expect(requestVerdict(asset(`${STAGING_ORIGIN}/_next/static/app.js`))).toBe('staging');
  });

  test('a page anywhere else is refused: production, another preview, a look-alike host', () => {
    for (const url of [
      'https://app.werk-flow.app/dashboard',
      'https://werkflow-app-git-feature-werkflows-projects.vercel.app/',
      `${STAGING_ORIGIN}.evil.example/`,
      'https://werkflow-app-git-main-werkflows-projects.vercel.app.evil.example/login',
      `http://werkflow-app-git-main-werkflows-projects.vercel.app/login`,
      `https://user:pass@werkflow-app-git-main-werkflows-projects.vercel.app/login`,
      'not a url',
    ])
      expect(requestVerdict(page(url)), url).toBe('refused');
  });

  test('a sandbox Checkout page loads, a live one never does', () => {
    expect(requestVerdict(page('https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fragment'))).toBe(
      'elsewhere',
    );
    expect(requestVerdict(page('https://checkout.stripe.com/g/pay/cs_test_a1B2c3'))).toBe('elsewhere');
    expect(requestVerdict(page('https://checkout.stripe.com/c/pay/cs_live_a1B2c3'))).toBe('refused');
    expect(requestVerdict(page('https://checkout.stripe.com/'))).toBe('refused');
    expect(requestVerdict(page('https://dashboard.stripe.com/test/payments'))).toBe('refused');
  });

  test("the pages' own assets and embedded frames elsewhere load, over https only", () => {
    expect(requestVerdict(asset('https://mbkkzuqjbdvzelqvuzcn.supabase.co/rest/v1/profiles'))).toBe(
      'elsewhere',
    );
    expect(requestVerdict(embedded('https://js.stripe.com/v3/elements-inner.html'))).toBe('elsewhere');
    expect(requestVerdict(asset('http://tracker.example/pixel.gif'))).toBe('refused');
  });
});

describe('header scoping', () => {
  test('a document request to staging carries the bypass and asks for its cookie', () => {
    expect(bypassHeaders(page(`${STAGING_ORIGIN}/login`), SECRET)).toEqual({
      'x-vercel-protection-bypass': SECRET,
      'x-vercel-set-bypass-cookie': 'true',
    });
    expect(bypassHeaders(asset(`${STAGING_ORIGIN}/api/background-read`), SECRET)).toEqual({
      'x-vercel-protection-bypass': SECRET,
    });
  });

  test('no other origin ever sees the bypass: Stripe, Supabase, production or a look-alike', () => {
    for (const request of [
      page('https://checkout.stripe.com/c/pay/cs_test_a1B2c3'),
      asset('https://api.stripe.com/v1/payment_pages'),
      asset('https://mbkkzuqjbdvzelqvuzcn.supabase.co/auth/v1/token'),
      page('https://app.werk-flow.app/login'),
      page(`${STAGING_ORIGIN}.evil.example/login`),
    ])
      expect(bypassHeaders(request, SECRET), request.url).toEqual({});
  });
});

test("a refused request is named by its origin, never by its path's tokens", () => {
  expect(refusedOrigin('https://app.werk-flow.app/auth/callback?code=made-up')).toBe(
    'https://app.werk-flow.app',
  );
  expect(refusedOrigin('::')).toBe('an unreadable URL');
});
