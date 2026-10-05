import { useState } from 'react';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { usePlanningOptions } from '@/hooks/use-planning-options';
import { CalendarOrganizationContext } from './calendar-service-boundaries';
import './planning-option-service-boundaries';

function PlanningOptionReader(): React.JSX.Element {
  const [selected, setSelected] = useState<string[] | null>(null);
  const search = usePlanningOptions('employees', selected, window.planningOptionContract.defaults);
  return (
    <>
      <SearchableMultiSelect
        {...search.select}
        ariaLabel="Mitarbeiter"
        selectedIds={search.selectedIds}
        onSelectionChange={setSelected}
      />
      <output aria-label="Auswahl">{search.selectedIds.join(',')}</output>
      <output aria-label="Vorauswahl geladen">{String(!search.resolvingDefaults)}</output>
    </>
  );
}
export function PlanningOptionContractFixture(): React.JSX.Element {
  const [organization, setOrganization] = useState('00000000-0000-4000-8000-000000000001');
  return (
    <CalendarOrganizationContext.Provider value={organization}>
      <button onClick={() => setOrganization('00000000-0000-4000-8000-000000000002')}>
        Organisation wechseln
      </button>
      <PlanningOptionReader />
    </CalendarOrganizationContext.Provider>
  );
}
