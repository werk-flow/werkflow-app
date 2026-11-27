import type { AiThreadEntry, AiThreadRow } from '@/lib/ai/thread-types';
import { sameOriginTarget } from '@/lib/ui/ai-markdown-text';

// What the WerkFlow KI timeline derives from its entries (werk-flow/werkflow-planning#533):
// where a row stands, whether a question is answered, and what an opened tool
// row lists. The rows themselves render in components/ki/ki-rows.tsx.

/** The command a stored entry belongs to: every key of a turn starts with its command id. */
const commandOf = (key: string): string => key.split(':')[0] ?? key;

/**
 * The timeline's order. A turn's tool calls and to-do list stand above its
 * answer, where the work happened before the answer was written; everything
 * else, a question included, stands at its sequence.
 */
export function timelineOrder<Entry extends AiThreadEntry>(entries: readonly Entry[]): Entry[] {
  const answers = new Map(
    entries.flatMap((entry) =>
      entry.role === 'assistant' ? [[commandOf(entry.key), entry.sequence] as const] : [],
    ),
  );
  const place = (entry: Entry): [number, number, number] => {
    const answer = answers.get(commandOf(entry.key));
    return (entry.role === 'tool' || entry.role === 'todo') && answer !== undefined
      ? [answer, 0, entry.sequence]
      : [entry.sequence, 1, 0];
  };
  return entries.toSorted((left, right) => {
    const [a, b] = [place(left), place(right)];
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
}

/**
 * What a question's row shows: the person's answer is their next message, so
 * a question with a message after it is answered with that text. Only the
 * thread's last question without one waits for an answer.
 */
export function questionAnswer(
  entries: readonly AiThreadEntry[],
  question: AiThreadRow,
): { answered: string } | 'open' | 'closed' {
  const after = entries.filter((entry) => entry.sequence > question.sequence);
  const reply = after.find((entry) => entry.role === 'user');
  if (reply?.role === 'user') return { answered: reply.text };
  return after.some((entry) => entry.role === 'question') ? 'closed' : 'open';
}

/**
 * Whether a row still runs: one left running by a turn that ended (its
 * answer finished) shows as broken off.
 */
export function rowRunning(entries: readonly AiThreadEntry[], row: AiThreadRow): boolean | 'stopped' {
  if (row.status !== 'streaming') return false;
  const answer = entries.find(
    (entry) => entry.role === 'assistant' && commandOf(entry.key) === commandOf(row.key),
  );
  return answer && answer.status !== 'streaming' ? 'stopped' : true;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

/** A tool result's text: plain, or record text with its source label. */
function textOf(value: Json | undefined): string | null {
  if (typeof value === 'string') return value || null;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string')
    return value.text || null;
  return null;
}

/** A field that names a record by id, which a person does not read. */
const ID_KEY = /id$/i;

export type ToolDetailLines = {
  /** The input the tool ran with: one line per field. */
  input: string[];
  /** The records it found: their visible fields, and a link into the app where one leads. */
  entries: { text: string; href: string | null }[];
  /** How many matched in all, when the tool says so. */
  total: number | null;
};

/** One record of a result as one line, without ids and nested lists. */
function entryLine(record: { [key: string]: Json | undefined }): { text: string; href: string | null } {
  const fields = Object.entries(record).flatMap(([key, value]) =>
    key === 'link' || ID_KEY.test(key) ? [] : [textOf(value) ?? []].flat(),
  );
  const link = textOf(record.link);
  return { text: fields.join(' · '), href: link ? sameOriginTarget(link) : null };
}

/** What an opened tool row lists from its stored input and result. */
export function toolDetailLines(detail: {
  input?: Json | undefined;
  result?: Json | undefined;
}): ToolDetailLines {
  const input =
    detail.input && typeof detail.input === 'object' && !Array.isArray(detail.input)
      ? Object.entries(detail.input).flatMap(([key, value]) => {
          const shown = Array.isArray(value) ? value.map(textOf).filter(Boolean).join(', ') : textOf(value);
          return shown ? [`${key}: ${shown}`] : [];
        })
      : [];
  const result =
    detail.result && typeof detail.result === 'object' && !Array.isArray(detail.result) ? detail.result : {};
  const entries = Object.values(result).flatMap((value) =>
    Array.isArray(value)
      ? value.flatMap((record) =>
          record && typeof record === 'object' && !Array.isArray(record) ? [entryLine(record)] : [],
        )
      : [],
  );
  return { input, entries, total: typeof result.gesamt === 'number' ? result.gesamt : null };
}
