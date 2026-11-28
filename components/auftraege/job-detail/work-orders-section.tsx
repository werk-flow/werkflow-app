import { AcceptedScopeList } from '@/components/angebote/offer-decision';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';
import { TextLink } from '@/components/ui/text-link';
import type { WorkOrder } from '@/lib/orders/types';
import { formatBerlin, formatGermanDate } from '@/lib/utils';

/**
 * „Auftragsumfang“ of a job or project for Admin and Büro: each accepted offer
 * it was converted from, with its prices, linked to the offer and its
 * revision. The baseline never changes. Work without an order shows nothing.
 */
export function WorkOrdersSection({ orders }: { orders: WorkOrder[] | 'failed' }) {
  if (orders === 'failed') {
    return (
      <RegionLoadError title="Der Auftragsumfang konnte nicht geladen werden">
        Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  if (orders.length === 0) return null;
  return (
    <section aria-labelledby="work-orders-title" className="space-y-3">
      <SectionTitle id="work-orders-title">Auftragsumfang</SectionTitle>
      {orders.map((order) => (
        <div key={order.id} className="space-y-3 rounded-lg border bg-card p-4 text-sm shadow-xs">
          <div className="space-y-1 wrap-anywhere">
            <p className="font-medium">
              {'Aus Angebot '}
              <TextLink href={`/angebote/${order.offerId}`}>{order.offerNumber}</TextLink>
              {`, Revision ${order.revision}, angenommen von ${order.acceptedByName} am ${formatGermanDate(order.acceptedOn)}`}
            </p>
            <p className="text-muted-foreground">
              {`Übernommen am ${formatBerlin(order.convertedAt, 'date')}`}
              {order.convertedBy ? ` von ${order.convertedBy}` : ''}
            </p>
          </div>
          <AcceptedScopeList scope={order.scope} totals={order.totals} />
        </div>
      ))}
    </section>
  );
}
