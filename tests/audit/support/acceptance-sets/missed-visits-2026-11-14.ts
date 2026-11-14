import { inventoryCaptures } from '../acceptance-rounds';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#467 of 2026-11-14: the Wartung workspace with
 * its „Überfällig“ filter and badge, and the due action dialog.
 */
function missedVisitCaptures(): OpenSet {
  return {
    id: 'missed-visits-2026-11-14',
    captures: [
      {
        id: 'admin-service-wartung',
        role: 'admin',
        route: '/service/wartung',
        view: { kind: 'page' },
        widths: [1280, 375],
        schemes: ['light', 'dark'],
        reveal: 'Fälligkeiten',
      },
      ...inventoryCaptures().filter(
        (capture) => capture.view.kind === 'dialog' && capture.view.opener === 'service.due-action',
      ),
    ],
    standalone: [],
  };
}

acceptanceSet(missedVisitCaptures());
