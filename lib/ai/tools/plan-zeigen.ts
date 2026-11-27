import 'server-only';

import { defineTool } from '@/lib/ai/tools/define-tool';
import { z } from '@/lib/zod';

/**
 * A harness tool: the agent shows its plan for the turn as a to-do list and
 * ticks steps off by calling it again with the whole list. It reads and
 * changes nothing; the turn keeps one list, which each call replaces.
 */
export const planZeigen = defineTool({
  name: 'plan_zeigen',
  label: 'Plan zeigen',
  description:
    'Zeigt deinen Plan für eine Aufgabe mit mehreren Schritten als Liste. Ruf es mit der ganzen Liste erneut auf, sobald ein Schritt erledigt ist.',
  input: z.strictObject({
    schritte: z
      .array(z.strictObject({ text: z.string().trim().min(1).max(120), erledigt: z.boolean() }))
      .min(1)
      .max(8),
  }),
  roles: ['admin', 'buero', 'employee'],
  control: 'read',
  shows: 'todo_list',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: [],
  writesMemory: false,
  async execute() {
    return { status: 'ok', value: { gezeigt: true } };
  },
});
