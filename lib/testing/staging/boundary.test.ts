// A staging journey's browser reaches staging, DEV and Stripe's sandbox Checkout only, loads no page
// outside staging but a sandbox Checkout, and sends the Vercel bypass to staging's host only. Every
// value here is made up.
import { describe, expect, test } from 'bun:test';

import {
  STAGING_ORIGIN,
  bypassHeaders,
  refusedOrigin,
  requestVerdict,
  type BrowserRequest,
} from './boundary';

const SECRET = 'MadeUpBypassSecret0123456789abcd';
const DEV = 'devref0000000000000';
const verdict = (request: BrowserRequest) => requestVerdict(request, DEV);
const page = (url: string) => ({ url, navigation: true, mainFrame: true });
const asset = (url: string) => ({ url, navigation: false, mainFrame: true });
const embedded = (url: string) => ({ url, navigation: true, mainFrame: false });

describe('origin refusal', () => {
  test('staging loads, as a page or an asset', () => {
    expect(verdict(page(`${STAGING_ORIGIN}/dashboard`))).toBe('staging');
    expect(verdict(asset(`${STAGING_ORIGIN}/_next/static/app.js`))).toBe('staging');
  });

  test('a page anywhere else is refused: production, another preview, a look-alike host', () => {
    for (const url of [
      'https://app.werk-flow.app/dashboard',
      'https://werkflow-app-git-feature-werkflows-projects.vercel.app/',
      `${STAGING_ORIGIN}.evil.example/`,
      'http://werkflow-app-git-main-werkflows-projects.vercel.app/login',
      'https://user:pass@werkflow-app-git-main-werkflows-projects.vercel.app/login',
      `https://${DEV}.supabase.co/auth/v1/verify`,
      'not a url',
    ])
      expect(verdict(page(url)), url).toBe('refused');
  });

  test('a sandbox Checkout page loads, a live one never does', () => {
    expect(verdict(page('https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fragment'))).toBe('elsewhere');
    expect(verdict(page('https://checkout.stripe.com/g/pay/cs_test_a1B2c3'))).toBe('elsewhere');
    expect(verdict(page('https://checkout.stripe.com/c/pay/cs_live_a1B2c3'))).toBe('refused');
    expect(verdict(page('https://checkout.stripe.com/'))).toBe('refused');
    expect(verdict(page('https://dashboard.stripe.com/test/payments'))).toBe('refused');
  });

  test("DEV's project and the sandbox Checkout's hosts load as assets and frames", () => {
    for (const request of [
      asset(`https://${DEV}.supabase.co/rest/v1/profiles`),
      asset(`wss://${DEV}.supabase.co/realtime/v1/websocket`),
      embedded('https://js.stripe.com/v3/elements-inner.html'),
      asset('https://api.stripe.com/v1/payment_pages'),
      embedded('https://m.stripe.network/inner.html'),
      asset('https://b.stripecdn.com/assets/x.js'),
      embedded('https://newassets.hcaptcha.com/captcha/v1/x'),
    ])
      expect(verdict(request), request.url).toBe('elsewhere');
  });

  test('any other asset or frame is refused: PROD, another project, a look-alike, plain http', () => {
    for (const request of [
      asset('https://otherref00000000000.supabase.co/rest/v1/profiles'),
      asset(`https://${DEV}.supabase.co.evil.example/rest/v1/profiles`),
      asset('https://app.werk-flow.app/api/health'),
      embedded('https://app.werk-flow.app/dashboard'),
      asset('https://stripe.com.evil.example/x.js'),
      embedded('https://pay.google.com/gp/p/ui/payframe'),
      asset('http://js.stripe.com/v3/x.js'),
      asset(`ws://${DEV}.supabase.co/realtime/v1/websocket`),
    ])
      expect(verdict(request), request.url).toBe('refused');
  });
});

describe('header scoping', () => {
  test('a request to staging carries the bypass, and never asks for a cookie that would keep it', () => {
    expect(bypassHeaders(page(`${STAGING_ORIGIN}/login`), SECRET)).toEqual({
      'x-vercel-protection-bypass': SECRET,
    });
    expect(bypassHeaders(asset(`${STAGING_ORIGIN}/api/background-read`), SECRET)).toEqual({
      'x-vercel-protection-bypass': SECRET,
    });
  });

  test('no other origin ever sees the bypass: Stripe, Supabase, production or a look-alike', () => {
    for (const request of [
      page('https://checkout.stripe.com/c/pay/cs_test_a1B2c3'),
      asset('https://api.stripe.com/v1/payment_pages'),
      asset(`https://${DEV}.supabase.co/auth/v1/token`),
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
