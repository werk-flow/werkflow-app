// A staging journey's browser reaches staging, DEV and Stripe's sandbox Checkout only, loads no page
// outside staging but a sandbox Checkout or a signed billing download, and sends the Vercel bypass to staging's host only. Every
// value here is made up.
import { describe, expect, test } from 'bun:test';

import {
  STAGING_ORIGIN,
  bypassHeaders,
  refusalOf,
  refusedOrigin,
  requestVerdict,
  strayPageCloser,
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
      'https://user@werkflow-app-git-main-werkflows-projects.vercel.app/login',
      'https://:pass@werkflow-app-git-main-werkflows-projects.vercel.app/login',
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

  test("a signed download of a WerkFlow invoice original loads as a page, from R2's signed URL only", () => {
    const host = `https://${'0a'.repeat(16)}.eu.r2.cloudflarestorage.com`;
    const key = `werkflow-billing/invoices/in_1MadeUp/${'ab'.repeat(32)}.pdf`;
    const signature = `X-Amz-Signature=${'cd'.repeat(32)}`;
    const query = `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&${signature}`;
    expect(verdict(page(`${host}/werkflow-documents-dev/${key}${query}`))).toBe('elsewhere');
    expect(verdict(page(`${host}/werkflow-documents-dev/${key}?${signature}&x-id=GetObject`))).toBe(
      'elsewhere',
    );
    for (const url of [
      // No signature, an empty one, or one that is no SigV4 hex digest.
      `${host}/werkflow-documents-dev/${key}`,
      `${host}/werkflow-documents-dev/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256`,
      `${host}/werkflow-documents-dev/${key}?X-Amz-Signature=`,
      `${host}/werkflow-documents-dev/${key}?X-Amz-Signature=0abc`,
      `${host}/werkflow-documents-dev/${key}?X-Amz-Signature=${'cd'.repeat(32)}0`,
      // Any other key: another prefix, another object under werkflow-billing/, a path trick.
      `${host}/werkflow-documents-dev/organisations/x/${'ab'.repeat(32)}.pdf${query}`,
      `${host}/werkflow-documents-dev/werkflow-billing/storno/in_1/${'ab'.repeat(32)}.pdf${query}`,
      `${host}/werkflow-documents-dev/werkflow-billing/invoices/in_1/x.pdf${query}`,
      `${host}/werkflow-documents-dev/werkflow-billing/invoices/in_1/../${'ab'.repeat(32)}.pdf${query}`,
      `${host}/${key}${query}`,
      // PROD's bucket, or any other bucket, even with a valid key and signature.
      `${host}/werkflow-documents-prod/${key}${query}`,
      `${host}/made-up-bucket/${key}${query}`,
      // Another host, R2 outside the EU jurisdiction, or plain http.
      `https://${'0a'.repeat(16)}.r2.cloudflarestorage.com/werkflow-documents-dev/${key}${query}`,
      `https://made-up.eu.r2.cloudflarestorage.com/werkflow-documents-dev/${key}${query}`,
      `${host}.evil.example/werkflow-documents-dev/${key}${query}`,
      `http://${'0a'.repeat(16)}.eu.r2.cloudflarestorage.com/werkflow-documents-dev/${key}${query}`,
    ])
      expect(verdict(page(url)), url).toBe('refused');
    // Only as the page a click opens: never as an asset, a frame or a socket.
    expect(verdict(asset(`${host}/werkflow-documents-dev/${key}${query}`))).toBe('refused');
    expect(verdict(embedded(`${host}/werkflow-documents-dev/${key}${query}`))).toBe('refused');
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
      page(
        `https://${'0a'.repeat(16)}.eu.r2.cloudflarestorage.com/werkflow-documents-dev/werkflow-billing/invoices/in_1/${'ab'.repeat(32)}.pdf?X-Amz-Signature=${'cd'.repeat(32)}`,
      ),
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

describe('what a refusal does', () => {
  test("a page refused in the journey's own page fails the journey", () => {
    expect(refusalOf(page('https://stripe.com/'), true)).toBe('fail');
  });

  test('a page refused in a popup Stripe opens closes that popup and fails nothing', () => {
    expect(verdict(page('https://stripe.com/'))).toBe('refused');
    expect(refusalOf(page('https://stripe.com/'), false)).toBe('close');
  });

  test('a refused asset or frame is blocked in any page', () => {
    for (const inJourneyPage of [true, false]) {
      expect(refusalOf(asset('https://pay.google.com/gp/p/js/pay.js'), inJourneyPage)).toBe('block');
      expect(refusalOf(embedded('https://pay.google.com/'), inJourneyPage)).toBe('block');
    }
  });
});

describe('closing a stray page', () => {
  /** Pages by name, and each request's page once the fake browser has reported it. */
  const browser = () => {
    const owners = new Map<string, string>();
    const closed: string[] = [];
    const closer = strayPageCloser<string, string>({
      pageOf: (request) => owners.get(request) ?? null,
      journeyPage: () => 'journey',
      close: (page) => closed.push(page),
    });
    return { owners, closed, closer };
  };

  test('a refused popup closes, and only that popup: other pages stay open', () => {
    const { owners, closed, closer } = browser();
    owners.set('stripe-popup-load', 'stripe-popup');
    owners.set('checkout-popup-load', 'checkout-popup');
    closer.refused('stripe-popup-load');
    closer.pageOpened();
    expect(closed).toEqual(['stripe-popup']);
  });

  test("a popup's first page, refused before its page is reported, closes that page once it is", () => {
    const { owners, closed, closer } = browser();
    closer.refused('stripe-popup-load');
    expect(closed).toEqual([]);
    // Another page opens first: it is not the refused request's page, so it stays.
    owners.set('other-load', 'other-popup');
    closer.pageOpened();
    expect(closed).toEqual([]);
    owners.set('stripe-popup-load', 'stripe-popup');
    closer.pageOpened();
    closer.pageOpened();
    expect(closed).toEqual(['stripe-popup']);
  });

  test("the journey's own page never closes", () => {
    const { owners, closed, closer } = browser();
    owners.set('journey-load', 'journey');
    closer.refused('journey-load');
    closer.pageOpened();
    expect(closed).toEqual([]);
  });
});
