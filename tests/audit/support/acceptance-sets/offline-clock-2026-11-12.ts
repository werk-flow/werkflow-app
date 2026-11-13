import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import type { CaptureSpec } from '../acceptance-rounds';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#319 of 2026-11-12: the clock sheet with a time event the server
 * refused, its deletion question, and the question a sign-out asks over unsent work with its
 * discard confirmation.
 */
function offlineClockCaptures(): OpenSet {
  const dialog = (id: string, opener: DialogOpenerId): CaptureSpec => ({
    id,
    role: 'employee',
    route: '/dashboard',
    view: { kind: 'dialog', opener },
    widths: [1280, 375],
    schemes: ['light', 'dark'],
  });
  return {
    id: 'offline-clock-2026-11-12',
    captures: [
      dialog('employee-clock-sheet', 'field.clock'),
      dialog('employee-clock-sheet-unsent', 'field.clock-unsent'),
      dialog('employee-unsent-delete', 'field.unsent-delete'),
      dialog('employee-sign-out-unsent', 'field.unsent-work'),
      dialog('employee-sign-out-discard', 'field.unsent-discard'),
    ],
    standalone: [],
  };
}

acceptanceSet(offlineClockCaptures());
