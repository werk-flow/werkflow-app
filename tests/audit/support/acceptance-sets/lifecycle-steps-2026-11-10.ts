import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#159 of 2026-11-10: the access and employment
 * dialogs offer only the steps that fit, each with its effect, and the
 * member list's login chips.
 */
function lifecycleStepCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const member = { role: 'admin', route: '/mitarbeiter/[userId]' } as const;
  return {
    id: 'lifecycle-steps-2026-11-10',
    captures: [
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-access',
        ...member,
        view: { kind: 'dialog', opener: 'people.lifecycle-access' },
        ...both,
      },
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-transition',
        ...member,
        view: { kind: 'dialog', opener: 'people.lifecycle-transition' },
        ...both,
      },
      { id: 'admin-mitarbeiter', role: 'admin', route: '/mitarbeiter', view: { kind: 'page' }, ...both },
    ],
    standalone: [],
  };
}

acceptanceSet(lifecycleStepCaptures());
