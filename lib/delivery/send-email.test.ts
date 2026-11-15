import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

// The transport's contract (werk-flow/werkflow-planning#251, agreed with E2c on
// #17): a hosted deployment sends one Resend request with the idempotency key,
// sender, reply-to and attachments; Resend's answer becomes accepted, retryable
// or permanent; missing configuration is retryable and sends nothing; a local
// or CI process never calls the network and keeps the message once per key;
// logs carry no address, subject or provider body. Tier 2.
mock.module('server-only', () => ({}));
const logged: string[] = [];
const consoleError = spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
});
afterAll(() => consoleError.mockRestore());

const { sendEmail } = await import('./send-email');
const { memoryOutbox } = await import('./memory-outbox');

const HOSTED = {
  VERCEL_ENV: 'preview',
  RESEND_API_KEY: 're_test_synthetic',
  FROM_EMAIL: 'WerkFlow <rechnung@example.com>',
};
const message = {
  to: 'erika.musterfrau@example.com',
  subject: 'Die Lastschrift für WerkFlow hat nicht geklappt',
  html: '<p>Hallo</p>',
  text: 'Hallo',
  idempotencyKey: 'werkflow-billing-mail/0b9c6f1e-7d43-4c55-9a0e-2f4f7b0c1d11',
};

function answering(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = Object.assign(
    async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    },
    { preconnect: fetch.preconnect },
  );
  return { calls, fetchImpl };
}

describe('a hosted deployment sends through Resend', () => {
  test('one request carries the key, sender, reply-to and attachments, and answers the message id', async () => {
    const { calls, fetchImpl } = answering(200, { id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' });
    const result = await sendEmail(
      {
        ...message,
        replyTo: 'abrechnung@example.com',
        attachments: [
          {
            filename: 'RE-0001.pdf',
            content: new Uint8Array([37, 80, 68, 70]),
            contentType: 'application/pdf',
          },
        ],
      },
      HOSTED,
      fetchImpl,
    );
    expect(result).toEqual({ status: 'accepted', messageId: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.resend.com/emails');
    const headers = new Headers(call?.init.headers);
    expect(headers.get('idempotency-key')).toBe(message.idempotencyKey);
    expect(headers.get('authorization')).toBe('Bearer re_test_synthetic');
    expect(JSON.parse(String(call?.init.body))).toEqual({
      from: 'WerkFlow <rechnung@example.com>',
      to: ['erika.musterfrau@example.com'],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: 'abrechnung@example.com',
      attachments: [{ filename: 'RE-0001.pdf', content: 'JVBERg==', content_type: 'application/pdf' }],
    });
  });

  test.each([
    [
      429,
      { name: 'daily_quota_exceeded', message: 'quota for erika.musterfrau@example.com' },
      'retryable',
      'email_daily_quota_exceeded',
    ],
    [429, { name: 'rate_limit_exceeded' }, 'retryable', 'email_rate_limit_exceeded'],
    [500, { name: 'internal_server_error' }, 'retryable', 'email_internal_server_error'],
    [503, 'Service Unavailable', 'retryable', 'email_provider_503'],
    [401, { name: 'missing_api_key' }, 'retryable', 'email_provider_unauthorized'],
    [409, { name: 'concurrent_idempotent_requests' }, 'retryable', 'email_concurrent_idempotent_requests'],
    [422, { name: 'validation_error', message: 'Invalid `to` field' }, 'permanent', 'email_validation_error'],
    [409, { name: 'invalid_idempotent_request' }, 'permanent', 'email_invalid_idempotent_request'],
    [200, { unexpected: true }, 'retryable', 'email_provider_invalid_response'],
  ] as const)('HTTP %d %j is %s with code %s', async (status, body, outcome, code) => {
    const { fetchImpl } = answering(status, body);
    expect(await sendEmail(message, HOSTED, fetchImpl)).toEqual({ status: outcome, code });
  });

  test('an unreachable provider is retryable', async () => {
    const fetchImpl = Object.assign(
      async () => {
        throw new TypeError('fetch failed for erika.musterfrau@example.com');
      },
      { preconnect: fetch.preconnect },
    );
    expect(await sendEmail(message, HOSTED, fetchImpl)).toEqual({
      status: 'retryable',
      code: 'email_provider_unreachable',
    });
  });

  test('a missing key or sender is retryable and sends nothing', async () => {
    const { calls, fetchImpl } = answering(200, { id: 'unused' });
    for (const environment of [
      { ...HOSTED, RESEND_API_KEY: '' },
      { VERCEL_ENV: 'production', RESEND_API_KEY: 're_test_synthetic' },
    ]) {
      expect(await sendEmail(message, environment, fetchImpl)).toEqual({
        status: 'retryable',
        code: 'email_not_configured',
      });
    }
    expect(calls).toHaveLength(0);
  });

  test('an unusable idempotency key is refused before any request', async () => {
    const { calls, fetchImpl } = answering(200, { id: 'unused' });
    expect(await sendEmail({ ...message, idempotencyKey: '' }, HOSTED, fetchImpl)).toEqual({
      status: 'permanent',
      code: 'email_idempotency_key_invalid',
    });
    expect(calls).toHaveLength(0);
  });
});

test('a local or CI process keeps the message in memory, once per key, and never calls the network', async () => {
  const { calls, fetchImpl } = answering(200, { id: 'unused' });
  const local = { RESEND_API_KEY: 're_test_synthetic' };
  const first = await sendEmail(message, local, fetchImpl);
  const again = await sendEmail(message, local, fetchImpl);
  expect(first.status).toBe('accepted');
  expect(again).toEqual(first);
  expect(calls).toHaveLength(0);
  expect(
    memoryOutbox.messages().filter((kept) => kept.idempotencyKey === message.idempotencyKey),
  ).toHaveLength(1);
});

test('logs name the failure by code only', async () => {
  const { fetchImpl } = answering(429, {
    name: 'daily_quota_exceeded',
    message: 'quota for erika.musterfrau@example.com',
  });
  await sendEmail(message, HOSTED, fetchImpl);
  const text = logged.join('\n');
  expect(text).toContain('email_daily_quota_exceeded');
  for (const leak of [
    'erika.musterfrau',
    'Lastschrift',
    'Hallo',
    'quota for',
    're_test_synthetic',
    'Invalid `to`',
  ]) {
    expect(text).not.toContain(leak);
  }
});
