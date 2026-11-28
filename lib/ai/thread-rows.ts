import type { AiThreadRow } from '@/lib/ai/thread-types';
import { z } from '@/lib/zod';

// The rows of a WerkFlow KI thread besides its messages (werk-flow/werkflow-planning#533):
// tool calls, questions and to-do lists. The harness writes their bodies
// (lib/ai/tools/tool-calls.ts), the thread window reads them back
// (lib/ai/thread-reads.ts), and the live channel and the turn's stream carry
// the rows. A body holds only what the collapsed row shows; a tool's input
// and result are the item's detail, read when the person opens the row.

const revision = z.number().int().positive();
const status = z.enum(['streaming', 'complete', 'failed', 'cancelled']);
const outcome = z.enum(['ok', 'refused', 'failed', 'not_run']);
const control = z.enum(['read', 'draft', 'confirm']);
const step = z.object({ text: z.string().max(500), done: z.boolean() });

const toolCallBodySchema = z.object({
  revision,
  label: z.string().max(200),
  control,
  outcome: outcome.optional(),
  detail: z.boolean().optional(),
});
const questionBodySchema = z.object({
  revision,
  question: z.string().max(1000),
  options: z.array(z.string().max(200)).max(8),
});
const todoBodySchema = z.object({ revision, steps: z.array(step).max(20) });

export type ToolCallBody = z.infer<typeof toolCallBodySchema>;
export type QuestionBody = z.infer<typeof questionBodySchema>;
export type TodoBody = z.infer<typeof todoBodySchema>;

type StoredItem = {
  idempotency_key: string;
  sequence: number;
  kind: string;
  status: AiThreadRow['status'];
  body: unknown;
};

/** A stored row as the timeline shows it; null for a message or a body this build cannot read. */
export function rowFromItem(item: StoredItem): AiThreadRow | null {
  const base = { key: item.idempotency_key, sequence: item.sequence, status: item.status };
  if (item.kind === 'tool_call') {
    const parsed = toolCallBodySchema.safeParse(item.body);
    if (!parsed.success) return null;
    const { detail, ...body } = parsed.data;
    return { ...base, ...body, role: 'tool', outcome: body.outcome ?? null, hasDetail: detail ?? false };
  }
  if (item.kind === 'question') {
    const parsed = questionBodySchema.safeParse(item.body);
    return parsed.success ? { ...base, ...parsed.data, role: 'question' } : null;
  }
  if (item.kind === 'todo_list') {
    const parsed = todoBodySchema.safeParse(item.body);
    return parsed.success ? { ...base, ...parsed.data, role: 'todo' } : null;
  }
  return null;
}

const rowBase = { key: z.string().min(1).max(200), sequence: z.number().int().positive(), status, revision };

/** A row as the live channel and the turn's stream carry it. */
export const aiThreadRowSchema = z.discriminatedUnion('role', [
  z.object({
    ...rowBase,
    role: z.literal('tool'),
    label: z.string(),
    control,
    outcome: outcome.nullable(),
    hasDetail: z.boolean(),
  }),
  z.object({ ...rowBase, role: z.literal('question'), question: z.string(), options: z.array(z.string()) }),
  z.object({ ...rowBase, role: z.literal('todo'), steps: z.array(step) }),
]);
