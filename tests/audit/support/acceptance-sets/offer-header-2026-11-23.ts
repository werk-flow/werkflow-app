import { acceptanceSet, type OpenSet } from '../acceptance-sets';

type SetCapture = OpenSet['captures'][number];

/**
 * werk-flow/werkflow-planning#380 part 2 of 2026-11-23: the page of a draft
 * offer with „Bearbeiten“ and the dialog „Angebotskopf bearbeiten“, for Admin
 * and Büro. The page before the change is `offers-2026-11-14`'s
 * `<role>-angebot`. Each opens the layout world's draft offer.
 */
function roleCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return [
    { id: `${role}-angebot`, role, route: '/angebote/[offerId]', view: { kind: 'page' }, ...both },
    {
      id: `${role}-kopf`,
      role,
      route: '/angebote/[offerId]',
      view: { kind: 'dialog', opener: 'commercial.offer-header' },
      ...both,
    },
  ];
}

acceptanceSet({
  id: 'offer-header-2026-11-23',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
