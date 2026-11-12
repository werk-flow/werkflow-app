import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#283 of 2026-11-07: the library rows with their
 * archive line and the „Aufbewahrung“ section of the file details.
 */
function documentRetentionCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'document-retention-2026-11-07',
    captures: [
      { id: 'admin-dokumente', role: 'admin', route: '/dokumente', view: { kind: 'page' }, ...both },
      {
        id: 'admin-dokumente-details',
        role: 'admin',
        route: '/dokumente',
        view: { kind: 'dialog', opener: 'documents.details' },
        reveal: 'Aufbewahrung',
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(documentRetentionCaptures());
