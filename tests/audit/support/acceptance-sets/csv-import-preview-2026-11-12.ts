import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#371 of 2026-11-12: the CSV import with its
 * preview and a refused unit, the result with its report, the repeat warning,
 * an empty file and a file the browser cannot read, as Büro.
 */
function csvImportPreviewCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const inventory = { role: 'buero', route: '/inventar' } as const;
  const states = [
    ['buero-import-auswahl', 'inventory.import'],
    ['buero-import-vorschau', 'inventory.import-preview'],
    ['buero-import-ergebnis', 'inventory.import-result'],
    ['buero-import-wiederholung', 'inventory.import-repeat'],
    ['buero-import-leere-datei', 'inventory.import-empty-file'],
    ['buero-import-lesefehler', 'inventory.import-read-failure'],
  ] as const;
  return {
    id: 'csv-import-preview-2026-11-12',
    captures: states.map(([id, opener]) => ({ id, ...inventory, view: { kind: 'dialog', opener }, ...both })),
    standalone: [],
  };
}

acceptanceSet(csvImportPreviewCaptures());
