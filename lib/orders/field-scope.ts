import { z } from '@/lib/zod';
import type { FieldScopeLine, FieldScopeOrder } from './types';

// The scope a field worker and a project lead read of an order: the answer of
// get_work_scope, which already holds no price and no Nachlass, parsed into
// FieldScopeOrder. A text line that talks about prices, payment or taxes is
// left out here too: the field sees what to do, never what it costs.

const lineSchema = z.object({
  number: z.string().nullable(),
  kind: z.enum(['free', 'text']),
  name: z.string(),
  description: z.string(),
  quantity: z.string().nullable(),
  unitLabel: z.string().nullable(),
});

const scopeSchema = z.array(
  z.object({
    offerNumber: z.string(),
    workKind: z.enum(['job', 'project']),
    sections: z.array(z.object({ number: z.string(), title: z.string(), lines: z.array(lineSchema) })),
  }),
);

/** Words and signs of a text line about money, which the field never reads. */
const PRICE_TEXT =
  /€|\beur\b|preis|rabatt|nachlass|skonto|zahlung|zahlbar|netto|brutto|mwst|umsatzsteuer|kosten|betrag|zuschlag/i;

/** Whether a text line names a price, a discount, a payment or a tax. */
export function isPriceText(line: { name: string; description: string }): boolean {
  return PRICE_TEXT.test(line.name) || PRICE_TEXT.test(line.description);
}

function fieldLine(line: z.infer<typeof lineSchema>): FieldScopeLine[] {
  if (line.kind === 'text') {
    return isPriceText(line) ? [] : [{ kind: 'text', name: line.name, description: line.description }];
  }
  if (line.number === null || line.quantity === null || line.unitLabel === null) return [];
  return [
    {
      kind: 'position',
      number: line.number,
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unitLabel: line.unitLabel,
    },
  ];
}

/** The orders get_work_scope answered, as the field reads them. Throws on a malformed answer. */
export function fieldScopeFrom(data: unknown): FieldScopeOrder[] {
  const parsed = scopeSchema.safeParse(data);
  if (!parsed.success) throw new Error('work_scope_read_failed');
  return parsed.data.map((order) => ({
    offerNumber: order.offerNumber,
    workKind: order.workKind,
    sections: order.sections
      .map((section) => ({
        number: section.number,
        title: section.title,
        lines: section.lines.flatMap(fieldLine),
      }))
      .filter((section) => section.lines.length > 0),
  }));
}
