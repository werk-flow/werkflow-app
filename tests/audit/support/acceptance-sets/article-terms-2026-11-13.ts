import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#373 of 2026-11-13: the article dialog of an
 * article with two wholesalers and a price history, on each of its tabs, the
 * supplier dialog with its pack sentence, and the create dialog, for Admin
 * and Büro. Empty and failed tabs come from the component stand
 * (tests/ui-contracts/article-terms.spec.ts): a failed read of the terms is a
 * region the server renders, which no browser interception can produce.
 */
function articleTermsCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const views = [
    ['anlegen', 'inventory.item'],
    ['stammdaten', 'inventory.item-edit'],
    ['lieferanten', 'inventory.item-suppliers'],
    ['preise', 'inventory.item-prices'],
    ['lieferant-bearbeiten', 'inventory.article-supplier'],
  ] as const;
  return {
    id: 'article-terms-2026-11-13',
    captures: (['admin', 'buero'] as const).flatMap((role) =>
      views.map(([id, opener]) => ({
        id: `${role}-${id}`,
        role,
        route: '/inventar' as const,
        view: { kind: 'dialog' as const, opener },
        ...both,
      })),
    ),
    standalone: [],
  };
}

acceptanceSet(articleTermsCaptures());
