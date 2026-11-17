import { describe, expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));
const { resendWebhookSecret, verifyResendSignature } = await import('./resend-signature');

// Svix's published example (docs.svix.com, "Verifying Webhooks Manually"): a
// check that agrees only with itself would pass the route test and still
// refuse every delivery Resend sends.
const SVIX_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const SVIX_ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const SVIX_TIMESTAMP = 1614265330;
const SVIX_BODY = '{"test": 2432232314}';
const SVIX_SIGNATURE = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';

const headersOf = (signature: string) =>
  new Headers({ 'svix-id': SVIX_ID, 'svix-timestamp': String(SVIX_TIMESTAMP), 'svix-signature': signature });

describe('the Svix signature of a Resend signal', () => {
  test("Svix's own example verifies, beside other entries and within the tolerance", () => {
    const key = resendWebhookSecret(SVIX_SECRET);
    expect(key).not.toBeNull();
    if (!key) return;
    const at = (offsetSeconds: number) => (SVIX_TIMESTAMP + offsetSeconds) * 1000;
    expect(verifyResendSignature(key, headersOf(SVIX_SIGNATURE), SVIX_BODY, at(0))).toBe(SVIX_ID);
    expect(verifyResendSignature(key, headersOf(`v1,${'A'.repeat(43)}= ${SVIX_SIGNATURE}`), SVIX_BODY, at(300))).toBe(
      SVIX_ID,
    );
    expect(verifyResendSignature(key, headersOf(SVIX_SIGNATURE), SVIX_BODY, at(301))).toBeNull();
    expect(verifyResendSignature(key, headersOf(SVIX_SIGNATURE), SVIX_BODY, at(-301))).toBeNull();
    expect(verifyResendSignature(key, headersOf(SVIX_SIGNATURE), `${SVIX_BODY} `, at(0))).toBeNull();
  });

  test('a secret without the whsec_ form or with too few bytes counts as unset', () => {
    for (const value of [undefined, '', '   ', 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'whsec_c2hvcnQ=', 'whsec_not base64!']) {
      expect(resendWebhookSecret(value)).toBeNull();
    }
  });
});
