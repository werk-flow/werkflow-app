import 'server-only';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

/**
 * What a stop found: the answer `stopped` now, had `finished` already, or the
 * command has no answer in the thread (`not_found`). A refusal says the thread
 * is not the caller's, or the stop could not be saved.
 */
type AiStopVerdict = 'stopped' | 'finished' | 'not_found' | 'thread_not_found' | 'unavailable';

const verdictSchema = z.enum(['stopped', 'finished', 'not_found']);

/**
 * Stops the answer to one command of the author's thread (werk-flow/werkflow-planning#609):
 * the database finishes it as stopped with the text of its last partial save,
 * and the running turn ends at its next save or model step, aborts the
 * provider request, settles at what it spent and tells the other tabs. The
 * stop's key is the turn's command id, so a repeat changes nothing.
 */
export async function stopAiTurn(input: {
  organizationId: string;
  userId: string;
  threadId: string;
  commandId: string;
}): Promise<AiStopVerdict> {
  const { data, error } = await createSupabaseAdminClient().rpc('cancel_ai_turn', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_thread_id: input.threadId,
    p_command_id: input.commandId,
  });
  if (error) {
    if (error.message === 'ai_thread_not_found' || error.message === 'ai_actor_without_access')
      return 'thread_not_found';
    logError('stopAiTurn: stop failed', error);
    return 'unavailable';
  }
  const verdict = verdictSchema.safeParse(data);
  if (verdict.success) return verdict.data;
  logError('stopAiTurn: unexpected stop', 'invalid_result');
  return 'unavailable';
}
