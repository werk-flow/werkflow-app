'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatEuroCents } from '@/lib/document-rendering/format';
import type { PositionFigures } from '@/lib/offers/calculation';
import { markupSentence, withCostOrMarkup, type PositionForm } from '@/lib/offers/content-form';
import { formatMarginPercent } from './offer-calculation-panel';

/**
 * Kosten and Aufschlag, office-only: a markup on the cost sets the price,
 * and the Position's cost and margin follow every keystroke.
 */
export function PositionCostFields({
  costId,
  markupId,
  position,
  figures,
  onChange,
  errors,
  disabled,
}: {
  costId: string;
  markupId: string;
  position: PositionForm;
  /** The position's amount, cost and margin, or null while it cannot be read. */
  figures: PositionFigures | null;
  onChange: (position: PositionForm) => void;
  errors: Record<string, string | undefined>;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
      <Field
        label={
          position.costPriceQuantity === 1 ? 'Kosten netto' : `Kosten netto je ${position.costPriceQuantity}`
        }
        htmlFor={costId}
        error={errors[costId]}
      >
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={position.cost}
          onChange={(event) => onChange(withCostOrMarkup(position, { cost: event.target.value }))}
          placeholder="optional"
          disabled={disabled}
        />
      </Field>
      {/* Live, not on save: a markup is never stored, so it never stops a save. */}
      <Field label="Aufschlag %" htmlFor={markupId} error={markupSentence(position) ?? undefined}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={position.markup}
          onChange={(event) => onChange(withCostOrMarkup(position, { markup: event.target.value }))}
          placeholder="setzt den Preis"
          disabled={disabled}
        />
      </Field>
      <p className="col-span-2 text-sm text-muted-foreground tabular-nums sm:col-span-3 sm:pb-2 sm:text-right">
        {positionMarginSentence(figures)}
      </p>
    </div>
  );
}

/** „Kosten 17,26 € · Marge 9,28 € (35 %)“; without a cost, the whole amount counts as margin, as in „Kalkulation“. */
function positionMarginSentence(figures: PositionFigures | null): string {
  if (figures === null) return 'Marge: –';
  if (figures.costCents === null)
    return `Ohne Kosten · Marge ${formatEuroCents(figures.saleCents)} (ganzer Betrag)`;
  if (figures.marginCents === null) return 'Marge: –';
  const percent = figures.marginPermille === null ? '' : ` (${formatMarginPercent(figures.marginPermille)})`;
  return `Kosten ${formatEuroCents(figures.costCents)} · Marge ${formatEuroCents(figures.marginCents)}${percent}`;
}
