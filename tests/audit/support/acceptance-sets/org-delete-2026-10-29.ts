import { inventoryCaptures } from '../acceptance-rounds';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** werk-flow/werkflow-planning#85 of 2026-10-29: the organization deletion names its scope or its refusal. */
function organizationDeletionCaptures(): OpenSet {
  return {
    id: 'org-delete-2026-10-29',
    captures: inventoryCaptures().filter(
      (capture) => capture.view.kind === 'dialog' && capture.view.opener === 'settings.delete-org',
    ),
    standalone: [],
  };
}

acceptanceSet(organizationDeletionCaptures());
