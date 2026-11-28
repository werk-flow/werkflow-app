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

/** What a tool may do (B1): its row's icon. */
export type AiToolControl = 'read' | 'draft' | 'confirm';

/** How a tool call ended: only `ok` ran the tool to its result. */
export type AiToolOutcome = 'ok' | 'refused' | 'failed' | 'not_run';

type RowBase = {
  key: string;
  sequence: number;
  status: AiChatItem['status'];
  /** Each write of a row raises it: of two copies, the higher one is newer. */
  revision: number;
};

/** A tool call: its summary only; its input and result load when the row opens (brief non-negotiable 5). */
export type AiToolRow = RowBase & {
  role: 'tool';
  label: string;
  control: AiToolControl;
  outcome: AiToolOutcome | null;
  hasDetail: boolean;
};

/** A question of the agent with the answers it offers; the person's answer is their next message. */
export type AiQuestionRow = RowBase & { role: 'question'; question: string; options: string[] };

/** The agent's plan for the turn, ticked off as it goes. */
export type AiTodoRow = RowBase & { role: 'todo'; steps: { text: string; done: boolean }[] };

export type AiThreadRow = AiToolRow | AiQuestionRow | AiTodoRow;

/** One entry of the timeline: a message or a row of the agent's work. */
export type AiThreadEntry = AiChatMessage | AiThreadRow;

/** A thread's latest entries, oldest first; `hasOlder` when earlier ones were left out. */
export type AiThreadWindow = { messages: AiThreadEntry[]; hasOlder: boolean };

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

/** A tool row's input and result, which load only when the person opens the row. */
export const aiToolDetailInput = z.object({
  organizationId: uuidSchema,
  threadId: uuidSchema,
  key: z.string().min(1).max(200),
});
