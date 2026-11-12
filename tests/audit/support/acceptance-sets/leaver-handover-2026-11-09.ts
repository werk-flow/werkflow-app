import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#156 of 2026-11-09: a leaver's open work in the
 * personnel process, the transition that names it, and its handover.
 */
function leaverHandoverCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const member = { role: 'admin', route: '/mitarbeiter/[userId]' } as const;
  return {
    id: 'leaver-handover-2026-11-09',
    captures: [
      {
        id: 'admin-mitarbeiter-userId-personalprozess',
        ...member,
        view: { kind: 'page' },
        reveal: 'Personalprozess',
        ...both,
      },
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-transition',
        ...member,
        view: { kind: 'dialog', opener: 'people.lifecycle-transition' },
        ...both,
      },
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-handover',
        ...member,
        view: { kind: 'dialog', opener: 'people.lifecycle-handover' },
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(leaverHandoverCaptures());
