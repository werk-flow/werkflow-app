import 'server-only';

import { memoryOutbox } from '@/lib/delivery/memory-outbox';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';

// The Next server's one mail transport (werk-flow/werkflow-planning#251, agreed
// with E2c on #17). It sends one message and answers what happened; it knows no
// organization and keeps no record, so each caller keeps its own. Hosted
// deployments (VERCEL_ENV set) send through Resend with `RESEND_API_KEY` from
// `FROM_EMAIL`; every other process, local and CI, keeps the message in an
// in-memory outbox, so no test reaches Resend. Rate limits stay with the callers.
// Logs carry only a fixed label and a code: never an address, subject, body or
// provider answer.

type EmailAttachment = { filename: string; content: Uint8Array; contentType: string };

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Stable per logical message, so a repeated call after a lost answer sends
   * once. Resend keeps a key for 24 hours.
   */
  idempotencyKey: string;
  /** Defaults to `FROM_EMAIL`. */
  from?: string;
  replyTo?: string;
  attachments?: readonly EmailAttachment[];
};

/** A failure code is stable and safe to log and store; it never carries provider text. */
export type SendEmailResult =
  | { status: 'accepted'; messageId: string }
  | { status: 'retryable'; code: string }
  | { status: 'permanent'; code: string };

type EmailEnvironment = Readonly<Record<string, string | undefined>>;

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;
const LOCAL_SENDER = 'WerkFlow <noreply@werkflow.test>';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:/-]{1,256}$/;

// Only the id leaves Resend's answer; its error body is read for its `name`,
// a fixed provider code, and nothing else.
const acceptedSchema = z.object({ id: z.string().min(1).max(128) });
const providerErrorSchema = z.object({ name: z.string().regex(/^[a-z_]{1,64}$/) });

// Resend's own codes that a later attempt can pass; every other refusal is the message's fault.
const RETRYABLE_PROVIDER_CODES = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'concurrent_idempotent_requests',
  'internal_server_error',
  'application_error',
]);

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function providerCode(response: Response): Promise<string | null> {
  try {
    const parsed = providerErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.name : null;
  } catch {
    return null;
  }
}

async function sendThroughResend(
  message: EmailMessage & { from: string },
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<SendEmailResult> {
  let response: Response;
  try {
    response = await fetchImpl(RESEND_URL, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.attachments?.length
          ? {
              attachments: message.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: encodeBase64(attachment.content),
                content_type: attachment.contentType,
              })),
            }
          : {}),
      }),
    });
  } catch {
    return { status: 'retryable', code: 'email_provider_unreachable' };
  }

  if (response.ok) {
    const answer: unknown = await response.json().catch(() => null);
    const accepted = acceptedSchema.safeParse(answer);
    // Resend took the message but named no id: sending again under the same key is safe.
    return accepted.success
      ? { status: 'accepted', messageId: accepted.data.id }
      : { status: 'retryable', code: 'email_provider_invalid_response' };
  }
  const code = await providerCode(response);
  if (code && RETRYABLE_PROVIDER_CODES.has(code)) return { status: 'retryable', code: `email_${code}` };
  if (response.status === 429 || response.status >= 500) {
    return { status: 'retryable', code: `email_provider_${response.status}` };
  }
  // A refused key is our configuration, not the message: retry once it is fixed.
  if (response.status === 401 || response.status === 403) {
    return { status: 'retryable', code: 'email_provider_unauthorized' };
  }
  return { status: 'permanent', code: code ? `email_${code}` : `email_provider_${response.status}` };
}

/**
 * Sends one message. A message sent again with the same idempotency key is
 * delivered once. Reads `VERCEL_ENV`, `RESEND_API_KEY` and `FROM_EMAIL`
 * (docs/technical/environments.md, "Credentials").
 */
export async function sendEmail(
  message: EmailMessage,
  environment: EmailEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SendEmailResult> {
  if (!IDEMPOTENCY_KEY.test(message.idempotencyKey)) {
    return { status: 'permanent', code: 'email_idempotency_key_invalid' };
  }
  const hosted = Boolean(environment.VERCEL_ENV);
  const from = message.from || environment.FROM_EMAIL?.trim() || (hosted ? '' : LOCAL_SENDER);
  const apiKey = environment.RESEND_API_KEY?.trim();
  if (hosted && (!apiKey || !from)) {
    // Missing configuration is ours to fix; the caller keeps the message and retries.
    logError('sendEmail: mail transport not configured', 'email_not_configured');
    return { status: 'retryable', code: 'email_not_configured' };
  }
  const result =
    hosted && apiKey
      ? await sendThroughResend({ ...message, from }, apiKey, fetchImpl)
      : memoryOutbox.keep({ ...message, from });
  if (result.status !== 'accepted') logError('sendEmail: mail not accepted', result.code);
  return result;
}
