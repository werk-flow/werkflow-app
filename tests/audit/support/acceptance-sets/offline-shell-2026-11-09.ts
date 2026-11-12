import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** werk-flow/werkflow-planning#316 of 2026-11-09: the offline fallback the service worker serves without network. */
function offlineShellCaptures(): OpenSet {
  return {
    id: 'offline-shell-2026-11-09',
    captures: [],
    standalone: [
      { id: 'standalone-offline', screen: '/offline', widths: [1280, 375], schemes: ['light', 'dark'] },
    ],
  };
}

acceptanceSet(offlineShellCaptures());
