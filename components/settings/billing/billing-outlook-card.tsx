import type { ReactNode } from 'react';

import { RegionLoadError } from '@/components/shared/region-load-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatEuroCents } from '@/lib/document-rendering/format';
import { formatGermanDate } from '@/lib/utils';
import { readWerkflowBillingOutlook } from '@/lib/werkflow-billing/billing-page';
import type { StripePaymentMethodSummary } from '@/lib/werkflow-billing/stripe-subscriptions';

const CARD_BRANDS: Readonly<Record<string, string>> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  cartes_bancaires: 'Cartes Bancaires',
  diners: 'Diners Club',
  discover: 'Discover',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

function paymentMethodText(method: StripePaymentMethodSummary | null): string {
  if (!method) return 'Keine Zahlungsart hinterlegt';
  const ending = (lastFour: string | null) => (lastFour ? `, endet auf ${lastFour}` : '');
  switch (method.kind) {
    case 'sepa_debit':
      return `SEPA-Lastschrift${ending(method.lastFour)}`;
    case 'card':
      return `${CARD_BRANDS[method.brand] ?? 'Karte'}${ending(method.lastFour)}`;
    case 'other':
      return 'Andere Zahlungsart';
  }
}

function OutlookFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** Stripe's next renewal and the payment method; fails on its own, with a retry. */
export async function BillingOutlookCard({ organizationId }: { organizationId: string }) {
  const result = await readWerkflowBillingOutlook(organizationId);
  if (!result.success) {
    return (
      <RegionLoadError title="Nächste Zahlung konnte nicht geladen werden">
        Der Zahlungsdienst ist gerade nicht erreichbar. Deine Rechnungen unten sind vollständig.
      </RegionLoadError>
    );
  }
  const { outlook } = result;
  if (!outlook) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nächste Zahlung</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          {outlook.upcoming ? (
            <>
              <OutlookFact label="Fällig am">{formatGermanDate(outlook.upcoming.dueAt)}</OutlookFact>
              <OutlookFact label="Betrag">{formatEuroCents(outlook.upcoming.amountCents)}</OutlookFact>
            </>
          ) : (
            // A cancelled or ended subscription renews no more.
            <OutlookFact label="Fällig am">Entfällt, WerkFlow bucht nichts mehr ab</OutlookFact>
          )}
          <OutlookFact label="Zahlungsart">{paymentMethodText(outlook.paymentMethod)}</OutlookFact>
        </dl>
      </CardContent>
    </Card>
  );
}
