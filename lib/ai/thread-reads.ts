import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import type { AiTurnFailure } from '@/lib/ai/turn';
import { AI_TURN_FAILURE_MESSAGES } from '@/lib/ai/turn-messages';
import { logError } from '@/lib/logging';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { rowFromItem } from '@/lib/ai/thread-rows';
import {
  type AiThreadEntry,
  type AiThreadSummary,
  type AiThreadWindow,
  aiThreadPageInput,
  aiThreadWindowInput,
  aiToolDetailInput,
} from '@/lib/ai/thread-types';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { z } from '@/lib/zod';

// The chat page's reads of the caller's own WerkFlow KI threads
// (werk-flow/werkflow-planning#530). They run as the signed-in user, so RLS
// lets only the author read a thread, and they filter by the caller's
// organization as well.

/** Threads per page of the list, latest activity first. */
const THREAD_PAGE_SIZE = 30;
/** Entries a thread opens with, newest first (brief non-negotiable 5): messages and the rows between them. */
const WINDOW_MESSAGES = 40;
/** UTF-8 bytes of message text and row bodies a window carries at most; older entries page in. */
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
  const { orgId } = auth.context;
  const supabase = await createSupabaseServerClient();
  const thread = await readOwnThread(supabase, auth.context, parsed.data.threadId);
  if (thread !== 'found') return { success: false, error: thread };
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

/** Whether the thread is the caller's in their organization: another person's reads as not found. */
async function readOwnThread(
  supabase: ThreadClient,
  caller: { orgId: string; userId: string },
  threadId: string,
): Promise<'found' | 'not_found' | 'load_failed'> {
  const { data, error } = await supabase
    .from('ai_threads')
    .select('id')
    .eq('organization_id', caller.orgId)
    .eq('user_id', caller.userId)
    .eq('id', threadId)
    .maybeSingle();
  if (error) {
    logError('aiThreadReads: thread read failed', error);
    return 'load_failed';
  }
  return data ? 'found' : 'not_found';
}

const toolDetailSchema = z.object({
  input: z.json().optional(),
  result: z.json().optional(),
  resultOmitted: z.literal(true).optional(),
});

/** What an opened tool row shows: the call's input and result as the model read them. */
export type AiToolDetail = z.infer<typeof toolDetailSchema>;

/**
 * One tool row's detail, read only when the person opens the row (brief
 * non-negotiable 5): the input the tool ran with and the result it gave. A
 * row that is not in the caller's own thread reads as not found.
 */
export async function getAiToolDetail(
  input: z.infer<typeof aiToolDetailInput>,
): Promise<{ success: true; detail: AiToolDetail } | ActionFailure> {
  const parsed = aiToolDetailInput.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContextFor(parsed.data.organizationId);
  if (!auth.success) return auth;
  const supabase = await createSupabaseServerClient();
  const thread = await readOwnThread(supabase, auth.context, parsed.data.threadId);
  if (thread !== 'found') return { success: false, error: thread };
  const { data, error } = await supabase
    .from('ai_thread_items')
    .select('detail')
    .eq('organization_id', auth.context.orgId)
    .eq('thread_id', parsed.data.threadId)
    .eq('idempotency_key', parsed.data.key)
    .eq('kind', 'tool_call')
    .maybeSingle();
  if (error) {
    logError('getAiToolDetail: detail read failed', error);
    return { success: false, error: 'load_failed' };
  }
  if (!data) return { success: false, error: 'not_found' };
  const detail = toolDetailSchema.safeParse(data.detail ?? {});
  return { success: true, detail: detail.success ? detail.data : {} };
}

/** A stored message as the timeline shows it, with the bytes it counts against the window. */
function messageFromItem(item: {
  idempotency_key: string;
  sequence: number;
  kind: string;
  status: AiThreadEntry['status'];
  body: unknown;
}): { entry: AiThreadEntry; bytes: number } | null {
  if (item.kind !== 'user_message' && item.kind !== 'assistant_message') {
    const row = rowFromItem(item);
    return row ? { entry: row, bytes: Buffer.byteLength(JSON.stringify(item.body), 'utf8') } : null;
  }
  const body = bodySchema.safeParse(item.body);
  const text = body.success ? body.data.text : '';
  return {
    bytes: Buffer.byteLength(text, 'utf8'),
    entry: {
      key: item.idempotency_key,
      sequence: item.sequence,
      role: item.kind === 'user_message' ? 'user' : 'assistant',
      status: item.status,
      text,
      failure:
        item.status === 'complete' ? null : turnFailureSentence(body.success ? body.data.failure : undefined),
    },
  };
}

/**
 * Up to a window of entries of every kind, in sequence order, so the window
 * has no hole a row would leave. With `after`, the ones from that sequence
 * on; `hasOlder` then says that they did not fit. Otherwise the latest ones,
 * or those before `before`, newest first under the byte cap. A row of a kind
 * this build cannot show takes its place unshown.
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
    .eq('thread_id', threadId);
  if (bound.before !== undefined) query = query.lt('sequence', bound.before);
  if (bound.after !== undefined) query = query.gte('sequence', bound.after);
  const { data, error } = await query
    .order('sequence', { ascending: bound.after !== undefined })
    .limit(WINDOW_MESSAGES + 1);
  if (error) {
    logError('getAiThreadWindow: item read failed', error);
    return 'load_failed';
  }
  const messages: AiThreadEntry[] = [];
  let bytes = 0;
  let read = 0;
  for (const item of data.slice(0, WINDOW_MESSAGES)) {
    const shown = messageFromItem(item);
    bytes += shown?.bytes ?? 0;
    if (read > 0 && bytes > WINDOW_BYTES) break;
    read += 1;
    if (shown) messages.push(shown.entry);
  }
  const hasOlder = read < data.length;
  return { messages: bound.after === undefined ? messages.reverse() : messages, hasOlder };
}
