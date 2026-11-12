import { inventoryCaptures } from '../acceptance-rounds';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** werk-flow/werkflow-planning#133 of 2026-10-30: the conversion dialog says where an undated job stays. */
function requestConversionCaptures(): OpenSet {
  return {
    id: 'request-convert-2026-10-30',
    captures: inventoryCaptures()
      .filter((capture) => capture.view.kind === 'dialog' && capture.view.opener === 'requests.convert')
      .map((capture) => ({ ...capture, reveal: 'Geplantes Datum' })),
    standalone: [],
  };
}

acceptanceSet(requestConversionCaptures());
