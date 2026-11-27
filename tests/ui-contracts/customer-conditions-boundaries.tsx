import { useState } from 'react';
import { ClientConditionDialog } from '@/components/kunden/client-condition-dialog';
import { ClientConditionsSection } from '@/components/kunden/client-conditions-section';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/action-result';
import type { CustomerCondition, CustomerConditions } from '@/lib/price-catalog/customer-conditions';
import { holdWrite } from './held-write-boundary';

// The dialog that records a new version of a customer's Kundenkonditionen
// (docs/features/customers-and-crm.md): it starts from the newest version,
// marks the fields at fault and sends nothing, holds its save in the write
// gate, keeps its values after a refusal and closes after an acceptance.
// The section around it saves through the action's stand-in
// (customer-conditions-service-boundaries.ts) and settles on the page's next
// render, which the spec lets land.

const newest: CustomerCondition = {
  id: 'contract-condition',
  version: 2,
  validFrom: '2026-01-01',
  discountTenths: { material: 100, arbeit: 50, anfahrt: 0 },
  leistungPrices: [
    {
      leistungId: 'contract-leistung',
      number: 'L-7',
      name: 'Monteurstunde',
      unit: 'hour',
      archived: false,
      salePriceCents: 6800,
    },
  ],
};

export function CustomerConditionsContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const record = async (...input: unknown[]): Promise<ActionResult> => {
    const refusal = await holdWrite('record-customer-condition', input);
    return refusal ? { success: false, error: refusal } : { success: true };
  };
  return (
    <main className="space-y-4 p-4">
      <h1>Komponentenverträge</h1>
      <Button onClick={() => setOpen(true)}>Konditionen ändern</Button>
      {open && (
        <ClientConditionDialog
          newest={newest}
          today="2026-11-27"
          onRecord={record}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}

/** The page's render after the accepted save: the recorded version on top. */
const recorded: CustomerConditions = {
  versions: [{ ...newest, id: 'contract-condition-recorded', version: 4, validFrom: '2026-11-27' }, newest],
  total: 4,
  applyingId: 'contract-condition-recorded',
};

export function CustomerConditionsSectionContractFixture(): React.JSX.Element {
  const [conditions, setConditions] = useState<CustomerConditions>({
    versions: [newest],
    total: 2,
    applyingId: newest.id,
  });
  return (
    <main className="space-y-4 p-4">
      <h1>Komponentenverträge</h1>
      {/* The page's refresh, held until the spec lets it land. */}
      <Button variant="outline" onClick={() => setConditions(recorded)}>
        Seite aktualisieren
      </Button>
      <ClientConditionsSection clientId="contract-client" archived={false} conditions={conditions} />
    </main>
  );
}
