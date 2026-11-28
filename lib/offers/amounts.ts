import { lineAmountCents } from '@/lib/inventory/line-amount';
import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { draftAmounts, MAX_LINE_NET_CENTS, type DraftAmounts } from '@/lib/invoices/amounts';
import { INVOICE_TAX_RATES, type InvoiceLineValues, type InvoiceTaxRate } from '@/lib/invoices/types';
import { lineCostCents } from './calculation';
import type {
  OfferAdjustment,
  OfferAdjustmentPosition,
  OfferFreePosition,
  OfferPosition,
  OfferPositionType,
  OfferSection,
} from './types';

// The amounts of an offer come from the one invoice core, as an invoice's do,
// so an invoice of the same positions later agrees with the offer: each priced
// position by the shared line rule, VAT per rate on the sum of that rate's
// positions. A Titel's subtotal is the sum of its normal positions and its
// Nachlässe and Zuschläge; a text line has no amount. A Bedarfs- or
// Alternativposition has its own amount by the same line rule, and no sum or
// VAT counts it. A Nachlass or Zuschlag in percent is a percentage of the
// normal priced Positionen of its Titel or of the offer, split by VAT rate:
// each part is the percentage of that rate's sum, rounded once by the line
// rule, and its amount is the sum of its parts, so VAT stays per rate on the
// sum of that rate's lines and parts. The editor shows them while the office
// types; the server computes them again from the parsed input and stores what
// it computed.

/** A Nachlass's or Zuschlag's amount at one VAT rate; its parts add up to its amount. */
type AdjustmentPart = { taxRateBasisPoints: InvoiceTaxRate; amountCents: number };

export type OfferAmounts = DraftAmounts & {
  /** Per Titel: its subtotal and each position's amount, `null` for a text line. */
  sections: Array<{ netCents: number; positionCents: Array<number | null> }>;
  /** Per Titel and place: a Nachlass's or Zuschlag's parts by VAT rate, `null` for every other line. */
  adjustmentParts: Array<Array<AdjustmentPart[] | null>>;
};

type PricedPosition = { kind: 'free'; positionType: OfferPositionType } & InvoiceLineValues;
type AdjustmentLine = Pick<OfferAdjustmentPosition, 'kind' | 'name' | 'adjustment'>;

/**
 * Titel as their amounts read them: each Position's kind and line values. A
 * Position's source and cost play no part, so a document's content, which
 * carries no cost, computes by the same rule as the editor's.
 */
type PricedSection = { positions: ReadonlyArray<{ kind: 'text' } | PricedPosition | AdjustmentLine> };

/** Whether a priced position counts in its Titel's subtotal, the totals and the VAT: a normal one. */
function isNormalPriced(position: { kind: string } | PricedPosition): position is PricedPosition {
  return position.kind === 'free' && 'positionType' in position && position.positionType.kind === 'normal';
}

/** Whether a position counts in its Titel's subtotal, the totals and the VAT: a normal priced one, a Nachlass or a Zuschlag. */
export function countsInTotal(
  position: { kind: 'text' | 'adjustment' } | Pick<PricedPosition, 'kind' | 'positionType'>,
): boolean {
  return (
    position.kind === 'adjustment' || (position.kind === 'free' && position.positionType.kind === 'normal')
  );
}

/** The largest percentage of a Nachlass or Zuschlag, in hundredths of a percent: 100 %. */
export const MAX_ADJUSTMENT_HUNDREDTHS = 10_000;

type CoveredLine = { amountCents: number; taxRateBasisPoints: InvoiceTaxRate };

/**
 * The parts of a Nachlass (negative) or Zuschlag by VAT rate. In percent:
 * per rate, the percentage of the sum of `covered`, the normal priced lines
 * it is a percentage of, rounded once half away from zero by the line rule; a
 * rate whose part is zero has none. A fixed amount is one part at its rate.
 */
function adjustmentParts(adjustment: OfferAdjustment, covered: readonly CoveredLine[]): AdjustmentPart[] {
  const sign = adjustment.direction === 'rabatt' ? -1 : 1;
  if (adjustment.scope === 'betrag') {
    return [
      { taxRateBasisPoints: adjustment.taxRateBasisPoints, amountCents: sign * adjustment.amountCents },
    ];
  }
  return INVOICE_TAX_RATES.flatMap((rate) => {
    const base = covered
      .filter((line) => line.taxRateBasisPoints === rate)
      .reduce((total, line) => total + line.amountCents, 0);
    // Hundredths of a percent are ten-thousandths: a quantity in thousandths per price quantity 10.
    const cents = lineAmountCents({ thousandths: BigInt(adjustment.percentHundredths) }, sign * base, 10);
    return cents === 0 ? [] : [{ taxRateBasisPoints: rate, amountCents: cents }];
  });
}

/**
 * An amount at one rate as the invoice core takes lines: flat rates of at
 * most one line's bound each, a credit for a negative amount. It may exceed
 * that bound, as the sum of its rate's lines does; split, it adds to its
 * rate's VAT basis all the same.
 */
function invoiceLinesOfPart(part: AdjustmentPart): InvoiceLineValues[] {
  const lines: InvoiceLineValues[] = [];
  for (let rest = Math.abs(part.amountCents); rest > 0; rest -= MAX_LINE_NET_CENTS) {
    lines.push({
      name: '',
      description: '',
      quantity: part.amountCents < 0 ? '-1' : '1',
      unit: 'flat_rate',
      unitPriceCents: Math.min(rest, MAX_LINE_NET_CENTS),
      priceQuantity: 1,
      taxRateBasisPoints: part.taxRateBasisPoints,
    });
  }
  return lines;
}

/**
 * Every Nachlass's and Zuschlag's parts as the invoice core takes them: per
 * VAT rate, their sum, added exactly first, so no order of them sums past the
 * safe range on the way to a total that fits.
 */
function adjustmentLines(parts: ReadonlyArray<AdjustmentPart[] | null>): InvoiceLineValues[] {
  const byRate = new Map<InvoiceTaxRate, bigint>();
  for (const part of parts.flatMap((lineParts) => lineParts ?? [])) {
    byRate.set(
      part.taxRateBasisPoints,
      (byRate.get(part.taxRateBasisPoints) ?? BigInt(0)) + BigInt(part.amountCents),
    );
  }
  return [...byRate].flatMap(([taxRateBasisPoints, cents]) => {
    const amountCents = Number(cents);
    if (!Number.isSafeInteger(amountCents))
      throw new RangeError('A sum of Nachlässe exceeds the safe range.');
    return invoiceLinesOfPart({ taxRateBasisPoints, amountCents });
  });
}

/**
 * The exact sum of amounts in cents, added in integers of any size, so no
 * order of them loses a cent on the way to a sum that fits. Throws a
 * RangeError when the sum itself leaves the safe range.
 */
export function exactCentsSum(values: readonly number[]): number {
  const cents = Number(values.reduce((total, value) => total + BigInt(value), BigInt(0)));
  if (!Number.isSafeInteger(cents)) throw new RangeError('A sum of an offer exceeds the safe range.');
  return cents;
}

const sumOf = (parts: readonly AdjustmentPart[]) => exactCentsSum(parts.map((part) => part.amountCents));

/** Every amount of an offer's content. Throws a RangeError on a position or part the line rule refuses. */
export function offerAmounts<Section extends PricedSection>(sections: readonly Section[]): OfferAmounts {
  const priced = sections.flatMap((section) =>
    section.positions.flatMap((position) => (position.kind === 'free' ? [position] : [])),
  );
  const normalCents = [...draftAmounts(priced.filter(isNormalPriced)).lineNetCents].reverse();
  // Outside the sums each one still takes its amount by the line rule, rounded once, and
  // within its own line bound: no VAT basis sums them.
  const outsideCents = priced
    .filter((position) => !isNormalPriced(position))
    .map((position) => draftAmounts([position]).lineNetCents[0])
    .reverse();
  const lineCents = sections.map((section) =>
    section.positions.map((position) => {
      if (position.kind !== 'free') return null;
      const cents = isNormalPriced(position) ? normalCents.pop() : outsideCents.pop();
      if (cents === undefined) throw new RangeError('A priced position has no computed amount.');
      return cents;
    }),
  );
  const covered = sections.map((section, sectionIndex) =>
    section.positions.flatMap((position, index): CoveredLine[] => {
      const amountCents = lineCents[sectionIndex]?.[index];
      return isNormalPriced(position) && typeof amountCents === 'number'
        ? [{ amountCents, taxRateBasisPoints: position.taxRateBasisPoints }]
        : [];
    }),
  );
  const parts = sections.map((section, sectionIndex) =>
    section.positions.map((position) =>
      position.kind === 'adjustment'
        ? adjustmentParts(
            position.adjustment,
            position.adjustment.scope === 'angebot' ? covered.flat() : (covered[sectionIndex] ?? []),
          )
        : null,
    ),
  );
  const amounts = draftAmounts([...priced.filter(isNormalPriced), ...adjustmentLines(parts.flat())]);
  // lineNetCents holds the counted lines, then each rate's Nachlässe and Zuschläge.
  return {
    ...amounts,
    adjustmentParts: parts,
    sections: sections.map((section, sectionIndex) => {
      const counted: number[] = [];
      const positionCents = section.positions.map((position, index) => {
        if (position.kind === 'text') return null;
        const lineParts = parts[sectionIndex]?.[index];
        const cents =
          position.kind === 'adjustment' ? lineParts && sumOf(lineParts) : lineCents[sectionIndex]?.[index];
        if (cents === null || cents === undefined)
          throw new RangeError('A priced position has no computed amount.');
        if (countsInTotal(position)) counted.push(cents);
        return cents;
      });
      return { netCents: exactCentsSum(counted), positionCents };
    }),
  };
}

type OfferContentArgument = {
  sections: Array<{
    title: string;
    netCents: number;
    positions: Array<
      | Extract<OfferPosition, { kind: 'text' }>
      | (OfferFreePosition & { unitLabel: string; amountCents: number })
      | (OfferAdjustmentPosition & { amountCents: number; taxSplit: AdjustmentPart[] })
    >;
  }>;
  totals: { netCents: number; taxCents: number; grossCents: number };
};

/**
 * The content as `save_offer_content` stores it: each priced position with its
 * unit's short label and its amount, each Nachlass and Zuschlag with its
 * amount and its parts by VAT rate, each Titel with its subtotal, and the
 * totals. Null for a position the line rule refuses, and for an amount the
 * computation did not answer: nothing stores a guessed zero.
 */
export function offerContentArgument(sections: readonly OfferSection[]): OfferContentArgument | null {
  try {
    const amounts = offerAmounts(sections);
    // A line cost the calculation refuses is refused by the save too, so every saved offer calculates.
    for (const position of sections.flatMap((section) => section.positions)) {
      if (position.kind === 'free' && position.cost) lineCostCents(position.quantity, position.cost);
    }
    return {
      sections: sections.map((section, sectionIndex) => {
        const computed = amounts.sections[sectionIndex];
        if (!computed) throw new RangeError('A Titel has no computed subtotal.');
        return {
          title: section.title,
          netCents: computed.netCents,
          positions: section.positions.map((position, positionIndex) => {
            if (position.kind === 'text') return position;
            const amountCents = computed.positionCents[positionIndex];
            if (amountCents === null || amountCents === undefined) {
              throw new RangeError('A priced position has no computed amount.');
            }
            if (position.kind === 'adjustment') {
              const taxSplit = amounts.adjustmentParts[sectionIndex]?.[positionIndex];
              if (!taxSplit) throw new RangeError('A Nachlass or Zuschlag has no computed parts.');
              return { ...position, amountCents, taxSplit };
            }
            const unit = INVENTORY_UNITS.find((candidate) => candidate.code === position.unit);
            return { ...position, unitLabel: unit?.shortLabel ?? position.unit, amountCents };
          }),
        };
      }),
      totals: {
        netCents: amounts.totals.lineNetCents,
        taxCents: amounts.totals.taxCents,
        grossCents: amounts.totals.grossCents,
      },
    };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
