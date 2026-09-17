import { useState } from 'react';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { CalendarOrganizationContext } from './calendar-service-boundaries';

function OptionReader(): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const { loadError, onLoadMore, ...search } = useJobEntityOptions({ kind: 'clients' }, selected);
  return <><SearchableMultiSelect {...search} {...(loadError !== undefined ? { loadError } : {})} {...(onLoadMore ? { onLoadMore } : {})} ariaLabel="Kunden" selectedIds={selected} onSelectionChange={setSelected} />
    <output aria-label="Auswahl">{selected.join(',')}</output></>;
}
export function OptionContractFixture(): React.JSX.Element {
  const [organization, setOrganization] = useState('00000000-0000-4000-8000-000000000001');
  return <CalendarOrganizationContext.Provider value={organization}>
    <button onClick={() => setOrganization('00000000-0000-4000-8000-000000000002')}>Organisation wechseln</button>
    <OptionReader />
  </CalendarOrganizationContext.Provider>;
}
