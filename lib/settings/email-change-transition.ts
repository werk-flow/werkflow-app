import 'server-only';

import type { User } from '@supabase/supabase-js';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';

const transitionResultSchema = z.union([
  z.object({ error: z.enum([
    'not_authenticated', 'cooldown', 'challenge_not_found', 'challenge_expired',
    'too_many_attempts', 'invalid_code', 'current_email_not_verified',
    'verification_window_expired', 'invalid_email', 'new_email_code_expired',
    'new_email_invalid_code', 'new_email_too_many_attempts', 'completion_pending', 'unexpected_error',
  ]) }),
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('completed'), email: z.string().email() }),
  z.object({
    status: z.enum(['claimed', 'completion_pending']), email: z.string().email(),
    token: uuidSchema, challengeId: uuidSchema,
  }),
]);

type TransitionResult = z.infer<typeof transitionResultSchema>;
type TransitionOperation = 'request_current' | 'verify_current' | 'save_new' | 'resend_new' |
  'verify_new' | 'complete' | 'abandon_rejected_completion' | 'reset';

/** The caller must supply the session user. Challenge IDs and tokens stay on the server. */
export async function transitionEmailChange(
  user: Pick<User, 'id' | 'email'>,
  operation: TransitionOperation,
  input: { codeHash?: string; newEmail?: string; challengeId?: string; completionToken?: string } = {},
): Promise<TransitionResult> {
  const admin = createSupabaseAdminClient();
  let challengeId = input.challengeId ?? null;
  if (operation !== 'request_current' && challengeId === null) {
    const { data, error } = await admin.from('email_change_challenges')
      .select('challenge_id').eq('user_id', user.id).maybeSingle();
    if (error) return { error: 'unexpected_error' };
    const parsed = z.object({ challenge_id: uuidSchema }).nullable().safeParse(data);
    if (!parsed.success) return { error: 'unexpected_error' };
    challengeId = parsed.data?.challenge_id ?? null;
  }
  // No legacy write fallback: before migration deployment this fails closed.
  const { data, error } = await admin.rpc('transition_email_change', {
    p_user_id: user.id,
    p_operation: operation,
    p_current_email: user.email ?? null,
    p_expected_challenge_id: challengeId,
    p_code_hash: input.codeHash ?? null,
    p_new_email: input.newEmail ?? null,
    p_completion_token: input.completionToken ?? null,
  });
  if (error) {
    console.error('Email change transition failed.', { code: error.code ?? 'unknown' });
    return { error: 'unexpected_error' };
  }
  const parsed = transitionResultSchema.safeParse(data);
  return parsed.success ? parsed.data : { error: 'unexpected_error' };
}
