import { InventoryMovementsView } from '@/components/inventar/inventory-movements-view';
import type { InventoryFilters } from '@/components/inventar/use-inventory-filters';
import type { InventoryLocation } from '@/lib/inventory/types';

// The movement history of /inventar without a row: an organization that has
// booked nothing yet, or a search whose filters match nothing. Only the second
// offers to reset the filters, and the reset clears them.

declare global {
  interface Window {
    uiContractInventoryHistoryResets: number;
  }
}

const location: InventoryLocation = {
  id: 'hauptlager',
  parentLocationId: null,
  name: 'Hauptlager',
  description: null,
  locationType: 'storage',
  sortOrder: 0,
  isActive: true,
};

function contractFilters(search: string): InventoryFilters {
  const noop = () => undefined;
  return {
    search,
    typeFilter: 'all',
    stockFilter: 'all',
    locationFilter: 'all',
    kindFilter: 'all',
    personFilter: 'all',
    fromDate: '',
    toDate: '',
    changeSearch: noop,
    changeType: noop,
    changeStock: noop,
    changeLocation: noop,
    changeKind: noop,
    changePerson: noop,
    changeFromDate: noop,
    changeToDate: noop,
    resetHistoryFilters: () => {
      window.uiContractInventoryHistoryResets += 1;
    },
  };
}

export function initializeInventoryMovementsBoundary(): void {
  window.uiContractInventoryHistoryResets = 0;
}

function EmptyHistory({ filtered }: { filtered: boolean }): React.JSX.Element {
  return (
    <section aria-label={filtered ? 'Bewegungen ohne Treffer' : 'Bewegungen ohne Verlauf'} className="p-4">
      <InventoryMovementsView
        history={{ status: 'loaded', entries: [], total: 0, hasAny: filtered, people: [] }}
        filters={contractFilters(filtered ? 'Gasbrennwert' : '')}
        locations={[location]}
        page={1}
        busy={false}
        onPageChange={() => undefined}
      />
    </section>
  );
}

export function InventoryMovementsContractFixture(): React.JSX.Element {
  return (
    <main className="space-y-4">
      <h1 className="px-4 pt-4">Komponentenverträge</h1>
      <EmptyHistory filtered={false} />
      <EmptyHistory filtered />
    </main>
  );
}
