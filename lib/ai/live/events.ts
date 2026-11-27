import { aiThreadRowSchema } from '@/lib/ai/thread-rows';
import { z } from '@/lib/zod';

// What a WerkFlow KI thread's live channel carries (werk-flow/werkflow-planning#532,
// brief non-negotiables 4, 7 and 9): the server sends a running turn to the
// author's other tabs and devices over the private Realtime Broadcast topic
// `ki-thread:<thread id>`, and a client joins only the thread it shows.
// The items' keys are the idempotency keys the thread reads return, so a live
// message and its saved copy are one message.

/**
 * The live protocol's version. Every event carries it; a tab whose build knows
 * an older one reloads once, so a deploy can force stale clients onto the new
 * code (the server-side reload switch). Raise it with every change of the
 * shapes below.
 */
export const KI_LIVE_PROTOCOL = 3;

/** The broadcast event name every message of the channel uses. */
export const KI_LIVE_EVENT = 'ki';

/** A thread's topic, with its id in lower case: the policy matches that spelling, and a uuid has no other. */
export function kiLiveTopic(threadId: string): string {
  return `ki-thread:${threadId.toLowerCase()}`;
}

const version = z.number().int().positive();
const command = z.string().min(1).max(200);

export const kiLiveEventSchema = z.discriminatedUnion('type', [
  z.object({
    v: version,
    type: z.literal('started'),
    command,
    user: z.object({ sequence: z.number().int().positive(), text: z.string() }),
    answer: z.object({ sequence: z.number().int().positive() }),
  }),
  z.object({
    v: version,
    type: z.literal('text'),
    command,
    /** Where the delta starts in the answer, in UTF-16 code units: a gap or a repeat shows. */
    at: z.number().int().nonnegative(),
    delta: z.string(),
    /** How much of the answer its last partial save holds: a read of the thread covers that much. */
    saved: z.number().int().nonnegative(),
  }),
  z.object({
    v: version,
    type: z.literal('row'),
    command,
    /** A tool call, question or to-do list of the turn, as saved; a later save of it carries a higher revision. */
    row: aiThreadRowSchema,
  }),
  z.object({
    v: version,
    type: z.literal('end'),
    command,
    status: z.enum(['complete', 'failed', 'cancelled']),
    /** Why the answer ended early, in German; null for a whole answer. */
    failure: z.string().nullable(),
    /** The saved answer's length: a client that holds another length reads the thread (2: a stop keeps less). */
    length: z.number().int().nonnegative(),
    /** The turn's latest rows as last saved, so a client that missed a row's send still ends with it. */
    rows: z.array(aiThreadRowSchema).max(50).optional(),
  }),
]);

export type KiLiveEvent = z.infer<typeof kiLiveEventSchema>;

type WithoutVersion<Event> = Event extends unknown ? Omit<Event, 'v'> : never;

/** A live event without its version: what the server builds. */
export type KiLiveMessage = WithoutVersion<KiLiveEvent>;
