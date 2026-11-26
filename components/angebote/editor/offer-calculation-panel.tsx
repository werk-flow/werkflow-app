import { SectionTitle } from '@/components/shared/section-title';
import { formatEuroCents } from '@/lib/document-rendering/format';
import type { CalculationFigures, OfferCalculation } from '@/lib/offers/calculation';
import type { SectionForm } from '@/lib/offers/content-form';

const PERCENT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** „27,1 %“ from 271 tenths of a percent; a margin below zero keeps its sign. */
export function formatMarginPercent(permille: number): string {
  return `${PERCENT.format(permille / 10)} %`;
}

/** Kosten, Verkauf netto, Marge and Marge % of a Titel or the offer, one per row on a phone. */
function FigureRow({
  label,
  figures,
  total,
}: {
  label: string;
  figures: CalculationFigures;
  total?: boolean;
}) {
  const cells: Array<[string, string]> = [
    ['Kosten', formatEuroCents(figures.costCents)],
    ['Verkauf netto', formatEuroCents(figures.saleCents)],
    ['Marge', formatEuroCents(figures.marginCents)],
    ['Marge %', figures.marginPermille === null ? '–' : formatMarginPercent(figures.marginPermille)],
  ];
  return (
    <div
      role="group"
      aria-label={label}
      className={total ? 'space-y-2 border-t pt-3 font-semibold' : 'space-y-2'}
    >
      <p className="min-w-0 text-sm break-words">{label}</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm tabular-nums sm:grid-cols-4">
        {cells.map(([term, value]) => (
          <div key={term} className="flex justify-between gap-2 text-right sm:block">
            <dt className="font-normal text-muted-foreground">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * „Kalkulation“: cost, sale amount and margin per Titel and for the offer,
 * live from the content as typed. Office-only: the page shows it to Admin and
 * Büro, and no document of the offer carries it. A Position without a cost
 * adds its whole sale amount to the margin; the panel names how many do.
 */
export function OfferCalculationPanel({
  sections,
  calculation,
}: {
  sections: readonly SectionForm[];
  calculation: OfferCalculation | null;
}) {
  const withoutCost = calculation?.offer.withoutCost ?? 0;
  return (
    <section aria-labelledby="offer-calculation-title" className="space-y-3 rounded-lg border p-3 sm:p-4">
      <div className="space-y-1">
        <SectionTitle as="h4" id="offer-calculation-title">
          Kalkulation
        </SectionTitle>
        <p className="text-sm text-muted-foreground">Nur für das Büro. Das Angebot zeigt keine Kosten.</p>
      </div>
      {calculation === null ? (
        <p className="text-sm text-muted-foreground">
          Die Kalkulation erscheint, sobald jede Position lesbar ist.
        </p>
      ) : (
        <>
          {calculation.sections.map((figures, index) => (
            <FigureRow
              key={sections[index]?.key ?? index}
              label={`Titel ${index + 1}${sections[index]?.title.trim() ? ` · ${sections[index]?.title.trim()}` : ''}`}
              figures={figures}
            />
          ))}
          <FigureRow label="Angebot gesamt" figures={calculation.offer} total />
          {withoutCost > 0 && (
            <p className="text-sm text-muted-foreground">
              {withoutCost === 1
                ? 'Bei 1 Position fehlen die Kosten. Die Marge enthält deren ganzen Betrag.'
                : `Bei ${withoutCost} Positionen fehlen die Kosten. Die Marge enthält deren ganzen Betrag.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
