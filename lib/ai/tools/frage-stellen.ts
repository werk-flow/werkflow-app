import 'server-only';

import { defineTool } from '@/lib/ai/tools/define-tool';
import { z } from '@/lib/zod';

/**
 * A harness tool: the agent asks the person a question with a few answers to
 * pick. It reads and changes nothing; the harness shows the question as a row
 * and ends the turn, and the person's answer is their next message.
 */
export const frageStellen = defineTool({
  name: 'frage_stellen',
  label: 'Frage stellen',
  description:
    'Fragt die Person mit 2 bis 4 kurzen Antworten zum Antippen, wenn du ohne ihre Entscheidung nicht weiterkommst. Danach endet deine Antwort; ihre Wahl kommt als nächste Nachricht.',
  input: z.strictObject({
    frage: z.string().trim().min(1).max(300),
    optionen: z.array(z.string().trim().min(1).max(80)).min(2).max(4),
  }),
  roles: ['admin', 'buero', 'employee'],
  control: 'read',
  shows: 'question',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: [],
  writesMemory: false,
  async execute() {
    return { status: 'ok', value: { gestellt: true } };
  },
});
