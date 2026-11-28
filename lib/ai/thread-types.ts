import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The shapes the chat page reads (lib/ai/thread-reads.ts) and renders
// (components/ki/), and the inputs of its background reads.

export type AiThreadSummary = { id: string; title: string | null; updatedAt: string };

type AiChatItem = {
  /** The item's idempotency key: the live turn uses it too, so a message keeps its place when it is saved. */
  key: string;
  sequence: number;
  status: 'streaming' | 'complete' | 'failed' | 'cancelled';
  text: string;
  /** Why an answer ended early, in German; null for a whole answer. */
  failure: string | null;
};

/** A file in a thread: the person's upload, or a file WerkFlow KI made (a KI-Entwurf until a person takes it). */
export type AiChatFile = {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  pages: number | null;
  origin: 'upload' | 'agent';
};

/** A typed item of the timeline: a message, or a file whose bytes load only when it is opened. */
export type AiChatMessage =
  | (AiChatItem & { role: 'user' | 'assistant' })
  | (AiChatItem & { role: 'file'; file: AiChatFile });

/** A thread's latest messages, oldest first; `hasOlder` when earlier ones were left out. */
export type AiThreadWindow = { messages: AiChatMessage[]; hasOlder: boolean };

export const aiThreadPageInput = z.object({
  organizationId: uuidSchema,
  /** The last thread of the page before, by both sort keys, so threads of one instant are not skipped. */
  before: z.object({ updatedAt: z.string().datetime({ offset: true }), id: uuidSchema }).optional(),
});

export const aiThreadWindowInput = z
  .object({
    organizationId: uuidSchema,
    threadId: uuidSchema,
    /** The sequence of the oldest message already shown. */
    beforeSequence: z.number().int().positive().optional(),
    /** A catch-up from the live channel's cursor: the messages from this sequence on (lib/ai/live/follow.ts). */
    afterSequence: z.number().int().positive().optional(),
  })
  .refine((input) => input.beforeSequence === undefined || input.afterSequence === undefined);
