import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The shapes the chat page reads (lib/ai/thread-reads.ts) and renders
// (components/ki/), and the inputs of its background reads.

export type AiThreadSummary = { id: string; title: string | null; updatedAt: string };

export type AiChatMessage = {
  /** The item's idempotency key: the live turn uses it too, so a message keeps its place when it is saved. */
  key: string;
  sequence: number;
  role: 'user' | 'assistant';
  status: 'streaming' | 'complete' | 'failed' | 'cancelled';
  text: string;
  /** Why an answer ended early, in German; null for a whole answer. */
  failure: string | null;
};

/** A thread's latest messages, oldest first; `hasOlder` when earlier ones were left out. */
export type AiThreadWindow = { messages: AiChatMessage[]; hasOlder: boolean };

export const aiThreadPageInput = z.object({
  organizationId: uuidSchema,
  /** The `updatedAt` of the last thread of the page before. */
  before: z.string().datetime({ offset: true }).optional(),
});

export const aiThreadWindowInput = z.object({
  organizationId: uuidSchema,
  threadId: uuidSchema,
  /** The sequence of the oldest message already shown. */
  beforeSequence: z.number().int().positive().optional(),
});
