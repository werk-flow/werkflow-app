import 'server-only';

import { APICallError, NoOutputGeneratedError } from 'ai';

import type { AiTurnFailure } from '@/lib/ai/turn';
import { z } from '@/lib/zod';

/** A step the harness ends itself: the answer reached its cap, or the stream ended without finishing. */
export class TurnStop extends Error {
  constructor(readonly reason: 'answer_too_long' | 'interrupted') {
    super(reason);
    this.name = 'TurnStop';
  }
}

// Anthropic's codes for a reached spend limit: the workspace's or organization's, and the contract's.
const SPEND_LIMIT_CODES = new Set(['enforced_spend_limit_reached', 'contract_spend_limit_reached']);
const providerStreamErrorSchema = z.object({ statusCode: z.number(), data: z.unknown().optional() });
const spendLimitSchema = z.union([
  z
    .object({ error: z.object({ details: z.object({ error_code: z.string() }) }) })
    .transform((body) => body.error.details.error_code),
  z.object({ details: z.object({ error_code: z.string() }) }).transform((body) => body.details.error_code),
]);

/** Status and body of a provider failure: a refused request, or an error event inside its stream. */
export function providerFailure(error: unknown): { status: number | undefined; body: unknown } | null {
  if (APICallError.isInstance(error)) {
    try {
      return { status: error.statusCode, body: error.responseBody ? JSON.parse(error.responseBody) : null };
    } catch {
      return { status: error.statusCode, body: null };
    }
  }
  const streamError = providerStreamErrorSchema.safeParse(error);
  return streamError.success ? { status: streamError.data.statusCode, body: streamError.data.data } : null;
}

/**
 * Sorts a failed attempt. A spend limit (402, or 429 with a spend-limit
 * code) and every other refusal of the request
 * (400 and the rest of 4xx) are never retried; a timeout and a full answer
 * end the turn; overload, a server error, a lost connection and a stream that
 * ended early are retried.
 */
export function classifyAttemptFailure(error: unknown): {
  failure: AiTurnFailure;
  retryable: boolean;
  outcome: string;
} {
  if (error instanceof TurnStop) {
    return error.reason === 'answer_too_long'
      ? { failure: 'answer_too_long', retryable: false, outcome: 'answer_too_long' }
      : { failure: 'provider_unavailable', retryable: true, outcome: 'provider_error' };
  }
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { failure: 'timeout', retryable: false, outcome: 'timeout' };
  }
  // A stream that closed before its first event: retried like one that ended early.
  if (NoOutputGeneratedError.isInstance(error)) {
    return { failure: 'provider_unavailable', retryable: true, outcome: 'provider_error' };
  }
  const failure = providerFailure(error);
  if (!failure) return { failure: 'provider_unavailable', retryable: false, outcome: 'provider_error' };
  const { status, body } = failure;
  // No status, or a success status whose stream then broke: the connection failed, not the request.
  if (status === undefined || status < 400) {
    return { failure: 'provider_unavailable', retryable: true, outcome: 'provider_error' };
  }
  const spendLimit = spendLimitSchema.safeParse(body);
  if (status === 402 || (status === 429 && spendLimit.success && SPEND_LIMIT_CODES.has(spendLimit.data))) {
    return { failure: 'provider_refused', retryable: false, outcome: 'spend_limit' };
  }
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return { failure: 'provider_unavailable', retryable: true, outcome: 'provider_error' };
  }
  return { failure: 'provider_refused', retryable: false, outcome: 'provider_refused' };
}
