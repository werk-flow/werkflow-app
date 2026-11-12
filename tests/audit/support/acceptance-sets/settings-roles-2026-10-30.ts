import { slug, type CaptureSpec } from '../acceptance-rounds';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#135 of 2026-10-30: each role's settings sections,
 * the saves that stay enabled, the Zeiterfassung tab named after its page and
 * the subscription note of the create dialog.
 */
function settingsRoleCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  const specs: readonly Pick<CaptureSpec, 'role' | 'route' | 'view'>[] = [
    { role: 'admin', route: '/einstellungen/profil', view: page },
    { role: 'admin', route: '/einstellungen/organisation', view: page },
    { role: 'admin', route: '/einstellungen/mitarbeiter', view: page },
    { role: 'admin', route: '/dashboard', view: { kind: 'dialog', opener: 'settings.create-org' } },
    { role: 'buero', route: '/einstellungen/zeiterfassung', view: page },
    { role: 'buero', route: '/zeiterfassung/einstellungen', view: page },
    { role: 'employee', route: '/einstellungen/profil', view: page },
    { role: 'employee', route: '/einstellungen/mitarbeiter', view: page },
  ];
  return {
    id: 'settings-roles-2026-10-30',
    captures: specs.map(
      (spec): CaptureSpec => ({
        ...spec,
        id: `${spec.role}-${slug(spec.route)}${spec.view.kind === 'dialog' ? '-dialog-create-org' : ''}`,
        ...both,
      }),
    ),
    standalone: [],
  };
}

acceptanceSet(settingsRoleCaptures());
