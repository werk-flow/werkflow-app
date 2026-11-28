import { z } from '@/lib/zod';
import type { FieldScopeLine, FieldScopeOrder } from './types';

// The scope a field worker and a project lead read of an order: the answer of
// get_work_scope, which already holds no price column and no Nachlass, parsed
// into FieldScopeOrder. Every text the office wrote passes the same check
// here too: a text line about money and a Position named after money are left
// out, a Position's description about money is left empty, and a Titel named
// after money shows only its number. The field sees what to do, never what it costs.

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

/** Words and signs of a text about money, which the field never reads; „450,-“ is an amount. */
const PRICE_TEXT =
  /€|\beur\b|\d\s*,[-–]|preis|rabatt|nachlass|skonto|zahlung|zahlbar|netto|brutto|mwst|umsatzsteuer|kosten|betrag|zuschlag/i;

function fieldLine(line: z.infer<typeof lineSchema>): FieldScopeLine[] {
  const moneyDescription = PRICE_TEXT.test(line.description);
  if (PRICE_TEXT.test(line.name) || (line.kind === 'text' && moneyDescription)) return [];
  const description = moneyDescription ? '' : line.description;
  if (line.kind === 'text') return [{ kind: 'text', name: line.name, description }];
  if (line.number === null || line.quantity === null || line.unitLabel === null) return [];
  return [
    {
      kind: 'position',
      number: line.number,
      name: line.name,
      description,
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
        title: PRICE_TEXT.test(section.title) ? `Titel ${section.number}` : section.title,
        lines: section.lines.flatMap(fieldLine),
      }))
      .filter((section) => section.lines.length > 0),
  }));
}
