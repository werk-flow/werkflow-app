import { useState } from 'react';
import { LeistungPriceDialog } from '@/components/angebote/leistungen/leistung-price-dialog';
import {
  LeistungenCards,
  LeistungenTable,
  type LeistungRowActions,
} from '@/components/angebote/leistungen/leistungen-table';
import {
  PageActionButton,
  PageActionProvider,
  PageActionUnavailable,
  usePageAction,
} from '@/components/shared/page-action';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/action-result';
import type { LeistungListEntry } from '@/lib/price-catalog/types';

// The Leistungen list (docs/features/commercial-and-finance.md): a phone card
// shows what the desktop row shows, the price dialog closes after a saved price
// and keeps its values after a refusal, and „Leistung anlegen“ is offered only
// while the list that holds its dialog is loaded.

declare global {
  interface Window {
    uiContractLeistungen: { refusePrice: boolean; savedPrices: string[] };
  }
}

function entry(id: string, leistungNumber: string, name: string, description: string): LeistungListEntry {
  return {
    id,
    leistungNumber,
    name,
    description,
    kind: 'arbeit',
    unit: 'hour',
    taxRateBasisPoints: 1900,
    archived: false,
    currentVersionId: `${id}-v1`,
    nextValidFrom: null,
    versions: [
      {
        id: `${id}-v1`,
        validFrom: '2026-01-01',
        salePriceCents: 6500,
        costRateCents: 3800,
        recordedAt: '2026-01-01T08:00:00.000Z',
        superseded: false,
      },
    ],
  };
}

const entries = [
  entry('monteur', 'L-100', 'Arbeitszeit Monteur', 'Geselle, je angefangene Viertelstunde'),
  entry('anfahrt', 'L-200', 'Anfahrt Zone 1', ''),
];

export function initializeLeistungenBoundary(): void {
  window.uiContractLeistungen = { refusePrice: false, savedPrices: [] };
}

/** A data region that failed until „Erneut laden“, then holds the create dialog. */
function CreateRegion(): React.JSX.Element {
  const [failed, setFailed] = useState(true);
  const createDialog = usePageAction();
  if (failed)
    return (
      <section aria-label="Liste">
        <PageActionUnavailable />
        <p>Leistungen konnten nicht geladen werden</p>
        <Button onClick={() => setFailed(false)}>Erneut laden</Button>
      </section>
    );
  return (
    <section aria-label="Liste">
      <output aria-label="Anlegen-Dialog">{createDialog.open ? 'offen' : 'zu'}</output>
    </section>
  );
}

export function LeistungenContractFixture(): React.JSX.Element {
  const [pricesOf, setPricesOf] = useState<LeistungListEntry | null>(null);
  const actions: LeistungRowActions = {
    onOpenPrices: setPricesOf,
    onEdit: () => undefined,
    onSetArchived: () => undefined,
    isBusy: () => false,
  };
  const addPrice = async (leistungId: string, price: { salePrice: string }): Promise<ActionResult> => {
    if (window.uiContractLeistungen.refusePrice) return { success: false, error: 'save_failed' };
    window.uiContractLeistungen.savedPrices.push(`${leistungId} ${price.salePrice}`);
    return { success: true };
  };
  return (
    <main className="space-y-4 p-4">
      <h1>Komponentenverträge</h1>
      <PageActionProvider>
        <PageActionButton>Leistung anlegen</PageActionButton>
        <CreateRegion />
      </PageActionProvider>
      <LeistungenCards entries={entries} actions={actions} />
      <LeistungenTable entries={entries} actions={actions} />
      {pricesOf && (
        <LeistungPriceDialog
          entry={pricesOf}
          priceDate="2026-11-13"
          onClose={() => setPricesOf(null)}
          onAddPrice={addPrice}
        />
      )}
    </main>
  );
}
