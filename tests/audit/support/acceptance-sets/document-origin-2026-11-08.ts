import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#284 of 2026-11-08: the library with its search
 * placeholder and origin line, and the „Herkunft“ section of the file details.
 */
function documentOriginCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'document-origin-2026-11-08',
    captures: [
      { id: 'admin-dokumente', role: 'admin', route: '/dokumente', view: { kind: 'page' }, ...both },
      {
        id: 'buero-dokumente-details',
        role: 'buero',
        route: '/dokumente',
        view: { kind: 'dialog', opener: 'documents.details' },
        reveal: 'Herkunft',
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(documentOriginCaptures());
