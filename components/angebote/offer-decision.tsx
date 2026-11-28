import { SectionTitle } from '@/components/shared/section-title';
import { Badge } from '@/components/ui/badge';
import { formatEuroCents, formatQuantity } from '@/lib/document-rendering/format';
import type { AcceptedScopeSection } from '@/lib/offers/accepted-scope';
import { ACCEPTANCE_CHANNEL_LABELS, type OfferAcceptance, type OfferDecisions } from '@/lib/offers/types';
import { formatBerlin, formatGermanDate } from '@/lib/utils';

/**
 * The customer's decision on a sent offer: the standing Annahme with its
 * frozen Auftragsumfang, each withdrawn Annahme with its reason, or the
 * rejection or withdrawal of the offer. The screen states what the office
 * recorded; it claims no signature and no legal effect.
 */
export function OfferDecision({ decisions }: { decisions: OfferDecisions }) {
  const standing = decisions.acceptances.find((acceptance) => !acceptance.withdrawal);
  const withdrawn = decisions.acceptances.filter((acceptance) => acceptance.withdrawal);
  const { closing } = decisions;
  if (!standing && !closing && withdrawn.length === 0) return null;
  return (
    <section aria-labelledby="offer-decision-title" className="space-y-3">
      <SectionTitle id="offer-decision-title">Entscheidung des Kunden</SectionTitle>
      {closing && (
        <div className="space-y-1 rounded-lg border bg-card p-4 text-sm shadow-xs">
          <p className="font-medium">
            {closing.outcome === 'abgelehnt'
              ? `Ablehnung von Revision ${closing.revision} erfasst`
              : `Revision ${closing.revision} zurückgezogen`}
            {` am ${formatBerlin(closing.recordedAt, 'date')}`}
            {closing.recordedBy ? ` von ${closing.recordedBy}` : ''}
          </p>
          <p className="whitespace-pre-line text-muted-foreground wrap-anywhere">Grund: {closing.reason}</p>
        </div>
      )}
      {standing && <StandingAcceptance acceptance={standing} />}
      {withdrawn.length > 0 && (
        <ul className="space-y-2 text-sm">
          {withdrawn.map((acceptance) => (
            <li key={acceptance.id} className="space-y-1 rounded-lg border p-4 wrap-anywhere">
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Zurückgenommen</Badge>
                {`Annahme von Revision ${acceptance.revision} durch ${acceptance.acceptedByName} am ${formatGermanDate(acceptance.acceptedOn)}`}
              </p>
              {acceptance.withdrawal && (
                <p className="whitespace-pre-line text-muted-foreground">
                  {`Zurückgenommen am ${formatBerlin(acceptance.withdrawal.withdrawnAt, 'date')}`}
                  {acceptance.withdrawal.withdrawnBy ? ` von ${acceptance.withdrawal.withdrawnBy}` : ''}
                  {`: ${acceptance.withdrawal.reason}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StandingAcceptance({ acceptance }: { acceptance: OfferAcceptance }) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 text-sm shadow-xs">
      <div className="space-y-1 wrap-anywhere">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {`Revision ${acceptance.revision} angenommen von ${acceptance.acceptedByName} am ${formatGermanDate(acceptance.acceptedOn)}`}
          {acceptance.late && <Badge variant="warning">Nach Ablauf der Gültigkeit</Badge>}
        </p>
        <p className="text-muted-foreground">
          {`Per ${ACCEPTANCE_CHANNEL_LABELS[acceptance.channel]}`}
          {acceptance.recordedBy ? ` · Annahme erfasst von ${acceptance.recordedBy}` : ' · Annahme erfasst'}
        </p>
        {acceptance.note && <p className="whitespace-pre-line text-muted-foreground">{acceptance.note}</p>}
      </div>
      <div className="space-y-3">
        <p className="font-medium">Auftragsumfang</p>
        {acceptance.scope.map((section) => (
          <ScopeSection key={section.number} section={section} />
        ))}
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t pt-3 tabular-nums">
          <dt className="text-muted-foreground">Netto</dt>
          <dd className="text-right">{formatEuroCents(acceptance.totals.netCents)}</dd>
          <dt className="text-muted-foreground">Umsatzsteuer</dt>
          <dd className="text-right">{formatEuroCents(acceptance.totals.taxCents)}</dd>
          <dt className="font-medium">Brutto</dt>
          <dd className="text-right font-medium">{formatEuroCents(acceptance.totals.grossCents)}</dd>
        </dl>
      </div>
    </div>
  );
}

/**
 * One Titel of the Auftragsumfang: its lines with their descriptions, quantity and amount, a chosen
 * option marked, a Nachlass or Zuschlag with its amount as the revision froze it.
 */
function ScopeSection({ section }: { section: AcceptedScopeSection }) {
  return (
    <div className="space-y-1">
      <p className="flex justify-between gap-4 font-medium wrap-anywhere">
        <span>{`${section.number}. ${section.title}`}</span>
        <span className="shrink-0 tabular-nums">{formatEuroCents(section.netCents)}</span>
      </p>
      <ul className="divide-y">
        {section.positions.map((position, index) =>
          position.kind === 'adjustment' ? (
            <li key={position.number} className="flex justify-between gap-4 py-1.5">
              <span className="min-w-0 space-y-0.5 wrap-anywhere">
                <span className="flex flex-wrap items-center gap-2">
                  {`${position.number} ${position.name}`}
                  <Badge variant="secondary">
                    {position.adjustment.direction === 'rabatt' ? 'Nachlass' : 'Zuschlag'}
                  </Badge>
                </span>
                {position.description && (
                  <span className="block whitespace-pre-line text-muted-foreground">
                    {position.description}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">{formatEuroCents(position.amountCents)}</span>
            </li>
          ) : position.kind === 'text' ? (
            <li key={`text-${index}`} className="py-1.5 wrap-anywhere">
              {position.name}
              {position.description && (
                <span className="block whitespace-pre-line text-muted-foreground">
                  {position.description}
                </span>
              )}
            </li>
          ) : (
            <li key={position.number} className="flex justify-between gap-4 py-1.5">
              <span className="min-w-0 space-y-0.5 wrap-anywhere">
                <span className="flex flex-wrap items-center gap-2">
                  {`${position.number} ${position.name}`}
                  {position.option === 'bedarf' && <Badge variant="secondary">Bedarfsposition</Badge>}
                  {position.option === 'alternative' && (
                    <Badge variant="secondary">{`Statt ${position.replaces ?? ''}`}</Badge>
                  )}
                </span>
                {position.description && (
                  <span className="block whitespace-pre-line text-muted-foreground">
                    {position.description}
                  </span>
                )}
                <span className="block text-muted-foreground tabular-nums">
                  {`${formatQuantity(position.quantity)} ${position.unitLabel}`}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatEuroCents(position.amountCents)}</span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
