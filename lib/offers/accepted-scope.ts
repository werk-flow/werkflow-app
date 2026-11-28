import { PRICE_QUANTITIES } from '@/lib/inventory/article-price-terms';
import { INVOICE_TAX_RATES } from '@/lib/invoices/types';
import { z } from '@/lib/zod';
import { offerAmounts } from './amounts';

// The Auftragsumfang of an Annahme: the accepted revision's Titel and
// Positionen with each chosen Bedarfsposition in and each chosen
// Alternativposition in place of the Position it names. The database builds
// and freezes its lines from the revision
// (supabase/migrations/20270701120000_record_an_offer_acceptance_and_freeze_its_scope.sql);
// the server computes its totals here by the offer's line and VAT rule and
// the database checks the net against the lines. No cost reaches it.

const textLine = { name: z.string(), description: z.string() };

/** A priced Position as a sent revision froze it, with its printed number and amount. */
const frozenPricedSchema = z.object({
  number: z.string(),
  kind: z.literal('free'),
  ...textLine,
  quantity: z.string(),
  unit: z.string(),
  unitLabel: z.string(),
  unitPriceCents: z.number().int(),
  priceQuantity: z.literal(PRICE_QUANTITIES),
  taxRateBasisPoints: z.literal(INVOICE_TAX_RATES),
  amountCents: z.number().int(),
});

const frozenTextSchema = z.object({ kind: z.literal('text'), ...textLine });

/** offer_revisions.content: Titel in order with their Positionen and subtotals. */
export const revisionContentSchema = z.array(
  z.object({
    number: z.string(),
    title: z.string(),
    netCents: z.number().int(),
    positions: z.array(
      z.discriminatedUnion('kind', [
        frozenPricedSchema.extend({
          positionType: z.enum(['bedarf', 'alternative']).optional(),
          /** An Alternativposition's Position, by its printed number. */
          alternativeTo: z.string().optional(),
        }),
        frozenTextSchema,
      ]),
    ),
  }),
);
export type RevisionContent = z.infer<typeof revisionContentSchema>;

/** offer_acceptances.scope: the kept lines, a chosen option marked with what it replaces. */
export const acceptedScopeSchema = z.array(
  z.object({
    number: z.string(),
    title: z.string(),
    netCents: z.number().int(),
    positions: z.array(
      z.discriminatedUnion('kind', [
        frozenPricedSchema.extend({
          option: z.enum(['bedarf', 'alternative']).optional(),
          replaces: z.string().optional(),
        }),
        frozenTextSchema,
      ]),
    ),
  }),
);
export type AcceptedScopeSection = z.infer<typeof acceptedScopeSchema>[number];

/** A Bedarfs- or Alternativposition the customer can choose when accepting. */
export type OfferOption = { number: string; name: string; amountCents: number } & (
  | { kind: 'bedarf' }
  | { kind: 'alternative'; replaces: { number: string; name: string }; differenceCents: number }
);

type FrozenPriced = Extract<RevisionContent[number]['positions'][number], { kind: 'free' }>;

function pricedLines(content: RevisionContent): FrozenPriced[] {
  return content.flatMap((section) =>
    section.positions.flatMap((line) => (line.kind === 'free' ? [line] : [])),
  );
}

/** The revision's options in order; an Alternativposition names the Position it replaces and the difference. */
export function offerOptions(content: RevisionContent): OfferOption[] {
  const lines = pricedLines(content);
  return lines.flatMap((line): OfferOption[] => {
    const option = { number: line.number, name: line.name, amountCents: line.amountCents };
    if (line.positionType === 'bedarf') return [{ ...option, kind: 'bedarf' }];
    const replaced = lines.find((candidate) => candidate.number === line.alternativeTo);
    if (line.positionType !== 'alternative' || !replaced) return [];
    return [
      {
        ...option,
        kind: 'alternative',
        replaces: { number: replaced.number, name: replaced.name },
        differenceCents: line.amountCents - replaced.amountCents,
      },
    ];
  });
}

export type ScopeTotals = { netCents: number; taxCents: number; grossCents: number };

/**
 * The totals of the Auftragsumfang for the options `chosen` by number, or
 * null when one is not an option of the revision, is named twice, a second
 * Alternativposition replaces the same Position, or the sum is beyond what
 * the offer's amount rule computes.
 */
export function acceptedScopeTotals(content: RevisionContent, chosen: readonly string[]): ScopeTotals | null {
  const options = offerOptions(content);
  const picked = chosen.map((number) => options.find((option) => option.number === number));
  const replaced = picked.flatMap((option) =>
    option?.kind === 'alternative' ? [option.replaces.number] : [],
  );
  if (
    picked.some((option) => !option) ||
    new Set(chosen).size !== chosen.length ||
    new Set(replaced).size !== replaced.length
  ) {
    return null;
  }
  const kept = pricedLines(content).filter((line) =>
    line.positionType ? chosen.includes(line.number) : !replaced.includes(line.number),
  );
  try {
    const amounts = offerAmounts([
      { positions: kept.map((line) => ({ ...line, positionType: { kind: 'normal' as const } })) },
    ]);
    return {
      netCents: amounts.totals.lineNetCents,
      taxCents: amounts.totals.taxCents,
      grossCents: amounts.totals.grossCents,
    };
  } catch (error) {
    // Options beyond what one total can hold: nothing is guessed, as a content save refuses them.
    if (error instanceof RangeError) return null;
    throw error;
  }
}
