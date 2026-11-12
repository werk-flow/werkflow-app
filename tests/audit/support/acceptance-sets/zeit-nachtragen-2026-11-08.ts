import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#146 of 2026-11-08: the employee's one „Zeit
 * nachtragen“ in the Zeiterfassung header and the calendar, its form with
 * empty times, and the Verlauf without a second add action.
 */
function addTimeCaptures(): OpenSet {
  const phone = { role: 'employee', widths: [375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'zeit-nachtragen-2026-11-08',
    captures: [
      { id: 'employee-zeiterfassung', route: '/zeiterfassung', view: { kind: 'page' }, ...phone },
      {
        id: 'employee-zeiterfassung-dialog-field-manual-entry',
        route: '/zeiterfassung',
        view: { kind: 'dialog', opener: 'field.manual-entry' },
        ...phone,
      },
      {
        id: 'employee-zeiterfassung-tab-history',
        route: '/zeiterfassung',
        view: { kind: 'tab', value: 'history' },
        ...phone,
      },
      { id: 'employee-kalender', route: '/kalender', view: { kind: 'page' }, ...phone },
    ],
    standalone: [],
  };
}

acceptanceSet(addTimeCaptures());
