import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import type { AiTurnFailure } from '@/lib/ai/turn';
import { AI_TURN_FAILURE_MESSAGES } from '@/lib/ai/turn-messages';
import { logError } from '@/lib/logging';
import { resolveActionContextFor } from '@/lib/org/action-context';
import {
  type AiChatMessage,
  type AiThreadSummary,
  type AiThreadWindow,
  aiThreadPageInput,
  aiThreadWindowInput,
} from '@/lib/ai/thread-types';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { z } from '@/lib/zod';

// The chat page's reads of the caller's own WerkFlow KI threads
// (werk-flow/werkflow-planning#530). They run as the signed-in user, so RLS
// lets only the author read a thread, and they filter by the caller's
// organization as well.

/** Threads per page of the list, latest activity first. */
const THREAD_PAGE_SIZE = 30;
/** Messages a thread opens with, newest first (brief non-negotiable 5). */
const WINDOW_MESSAGES = 40;
/** Bytes of message bodies a window carries at most; older messages page in. */
const WINDOW_BYTES = 256_000;

const bodySchema = z.object({ text: z.string(), failure: z.string().optional() });

function isTurnFailure(code: string): code is AiTurnFailure {
  return Object.hasOwn(AI_TURN_FAILURE_MESSAGES, code);
}

function turnFailureSentence(code: string | undefined): string | null {
  if (code === undefined) return null;
  return AI_TURN_FAILURE_MESSAGES[isTurnFailure(code) ? code : 'interrupted'];
}

/** A page of the caller's threads in the organization, with whether more follow. */
export async function getAiThreadPage(
  input: z.infer<typeof aiThreadPageInput>,
): Promise<{ success: true; threads: AiThreadSummary[]; hasMore: boolean } | ActionFailure> {
  const parsed = aiThreadPageInput.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContextFor(parsed.data.organizationId);
  if (!auth.success) return auth;
  const { orgId, userId } = auth.context;
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('ai_threads')
    .select('id, title, updated_at')
    .eq('organization_id', orgId)
    .eq('user_id', userId);
  const before = parsed.data.before;
  if (before)
    query = query.or(
      `updated_at.lt.${before.updatedAt},and(updated_at.eq.${before.updatedAt},id.gt.${before.id})`,
    );
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .order('id')
    .limit(THREAD_PAGE_SIZE + 1);
  if (error) {
    logError('getAiThreadPage: thread read failed', error);
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    threads: data
      .slice(0, THREAD_PAGE_SIZE)
      .map((thread) => ({ id: thread.id, title: thread.title, updatedAt: thread.updated_at })),
    hasMore: data.length > THREAD_PAGE_SIZE,
  };
}

/**
 * The caller's thread as it opens: its latest messages under a byte cap, or
 * the ones before `beforeSequence` when older history pages in. A thread that
 * is not the caller's reads as not found.
 */
export async function getAiThreadWindow(
  input: z.infer<typeof aiThreadWindowInput>,
): Promise<{ success: true; window: AiThreadWindow } | ActionFailure> {
  const parsed = aiThreadWindowInput.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContextFor(parsed.data.organizationId);
  if (!auth.success) return auth;
  const { orgId, userId } = auth.context;
  const supabase = await createSupabaseServerClient();
  const thread = await supabase
    .from('ai_threads')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('id', parsed.data.threadId)
    .maybeSingle();
  if (thread.error) {
    logError('getAiThreadWindow: thread read failed', thread.error);
    return { success: false, error: 'load_failed' };
  }
  if (!thread.data) return { success: false, error: 'not_found' };
  let query = supabase
    .from('ai_thread_items')
    .select('idempotency_key, sequence, kind, status, body')
    .eq('organization_id', orgId)
    .eq('thread_id', parsed.data.threadId)
    .in('kind', ['user_message', 'assistant_message']);
  if (parsed.data.beforeSequence) query = query.lt('sequence', parsed.data.beforeSequence);
  const { data, error } = await query.order('sequence', { ascending: false }).limit(WINDOW_MESSAGES + 1);
  if (error) {
    logError('getAiThreadWindow: item read failed', error);
    return { success: false, error: 'load_failed' };
  }
  const messages: AiChatMessage[] = [];
  let bytes = 0;
  for (const item of data.slice(0, WINDOW_MESSAGES)) {
    const body = bodySchema.safeParse(item.body);
    const text = body.success ? body.data.text : '';
    bytes += text.length;
    if (messages.length > 0 && bytes > WINDOW_BYTES) break;
    messages.push({
      key: item.idempotency_key,
      sequence: item.sequence,
      role: item.kind === 'user_message' ? 'user' : 'assistant',
      status: item.status,
      text,
      failure:
        item.status === 'complete' ? null : turnFailureSentence(body.success ? body.data.failure : undefined),
    });
  }
  const hasOlder = messages.length < data.length;
  return { success: true, window: { messages: messages.reverse(), hasOlder } };
}
