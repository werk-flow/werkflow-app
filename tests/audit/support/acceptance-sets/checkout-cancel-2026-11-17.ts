import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#500 of 2026-11-17: an Admin who cancelled a
 * further organization's Checkout returns to „Neue Organisation erstellen“
 * with the calm „Zahlung abgebrochen“ notice and the way to pay again. No
 * before: the previous build returned to /upgrade.
 */
function checkoutCancelCaptures(): OpenSet {
  return {
    id: 'checkout-cancel-2026-11-17',
    captures: [],
    standalone: [
      {
        id: 'zahlung-abgebrochen',
        screen: '/upgrade/abgebrochen',
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
    ],
  };
}

acceptanceSet(checkoutCancelCaptures());
