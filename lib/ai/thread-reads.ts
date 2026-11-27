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
/** UTF-8 bytes of message text a window carries at most; older messages page in. */
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
 * the ones before `beforeSequence` when older history pages in. A catch-up
 * from the live channel's cursor reads the messages from `afterSequence` on,
 * oldest first; when more follow than one window holds, it reads the latest
 * window instead, which says that older messages exist. A thread that is not
 * the caller's reads as not found.
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
  const { afterSequence, beforeSequence } = parsed.data;
  const items = (bound: { after?: number; before?: number }) =>
    readWindowItems(supabase, orgId, parsed.data.threadId, bound);
  if (afterSequence !== undefined) {
    const newer = await items({ after: afterSequence });
    if (newer === 'load_failed') return { success: false, error: 'load_failed' };
    if (!newer.hasOlder) return { success: true, window: newer };
  }
  const window = await items(beforeSequence === undefined ? {} : { before: beforeSequence });
  if (window === 'load_failed') return { success: false, error: 'load_failed' };
  return { success: true, window };
}

type ThreadClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Up to a window of messages, in sequence order. With `after`, the ones from
 * that sequence on; `hasOlder` then says that they did not fit. Otherwise the
 * latest ones, or those before `before`, newest first under the byte cap.
 */
async function readWindowItems(
  supabase: ThreadClient,
  organizationId: string,
  threadId: string,
  bound: { after?: number; before?: number },
): Promise<AiThreadWindow | 'load_failed'> {
  let query = supabase
    .from('ai_thread_items')
    .select('idempotency_key, sequence, kind, status, body')
    .eq('organization_id', organizationId)
    .eq('thread_id', threadId)
    .in('kind', ['user_message', 'assistant_message']);
  if (bound.before !== undefined) query = query.lt('sequence', bound.before);
  if (bound.after !== undefined) query = query.gte('sequence', bound.after);
  const { data, error } = await query
    .order('sequence', { ascending: bound.after !== undefined })
    .limit(WINDOW_MESSAGES + 1);
  if (error) {
    logError('getAiThreadWindow: item read failed', error);
    return 'load_failed';
  }
  const messages: AiChatMessage[] = [];
  let bytes = 0;
  for (const item of data.slice(0, WINDOW_MESSAGES)) {
    const body = bodySchema.safeParse(item.body);
    const text = body.success ? body.data.text : '';
    bytes += Buffer.byteLength(text, 'utf8');
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
  return { messages: bound.after === undefined ? messages.reverse() : messages, hasOlder };
}
