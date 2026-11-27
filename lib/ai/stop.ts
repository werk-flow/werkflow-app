import 'server-only';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

/**
 * What a stop found: the answer `stopped` now, had `finished` already, or the
 * command has no answer in the thread (`not_found`). A refusal says the thread
 * is not the caller's, or the stop could not be saved.
 */
type AiStopVerdict =
  | { verdict: 'stopped'; length: number }
  | { verdict: 'finished' | 'not_found' | 'thread_not_found' | 'unavailable' };

// What `cancel_ai_turn` answers: the kept text's length only when it stopped the answer.
const stopSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('stopped'), text_length: z.number().int().nonnegative() }),
  z.object({ verdict: z.enum(['finished', 'not_found']) }),
]);

/**
 * Stops the answer to one command of the author's thread (werk-flow/werkflow-planning#609):
 * the database finishes it as stopped with the text of its last partial save
 * and returns that text's length, and the running turn ends at its next save
 * or model step, aborts the provider request and settles at what it spent.
 * The stop's key is the turn's command id, so a repeat changes nothing and
 * answers the kept length again.
 */
export async function stopAiTurn(input: {
  organizationId: string;
  userId: string;
  threadId: string;
  commandId: string;
}): Promise<AiStopVerdict> {
  const call = () =>
    createSupabaseAdminClient()
      .rpc('cancel_ai_turn', {
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_thread_id: input.threadId,
        p_command_id: input.commandId,
      })
      .single();
  let { data, error } = await call();
  // A failure may hide a stop that landed with its reply lost: a repeat answers it again, with the kept length.
  if (error && error.message !== 'ai_thread_not_found' && error.message !== 'ai_actor_without_access')
    ({ data, error } = await call());
  if (error) {
    if (error.message === 'ai_thread_not_found' || error.message === 'ai_actor_without_access')
      return { verdict: 'thread_not_found' };
    logError('stopAiTurn: stop failed', error);
    return { verdict: 'unavailable' };
  }
  const stop = stopSchema.safeParse(data);
  if (!stop.success) {
    logError('stopAiTurn: unexpected stop', 'invalid_result');
    return { verdict: 'unavailable' };
  }
  return stop.data.verdict === 'stopped'
    ? { verdict: 'stopped', length: stop.data.text_length }
    : { verdict: stop.data.verdict };
}
