import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#287 of 2026-11-08: the Admin's „Datenexport“
 * section, settled and loading, and the settings nav that leads there.
 */
function organizationExportCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'organization-export-2026-11-08',
    captures: [
      {
        id: 'admin-einstellungen-datenexport',
        role: 'admin',
        route: '/einstellungen/datenexport',
        view: { kind: 'page' },
        ...both,
      },
      {
        id: stateCaptureId('admin-einstellungen-datenexport', 'loading'),
        role: 'admin',
        route: '/einstellungen/datenexport',
        view: { kind: 'page' },
        state: 'loading',
        ...both,
      },
      {
        id: 'admin-einstellungen-organisation',
        role: 'admin',
        route: '/einstellungen/organisation',
        view: { kind: 'page' },
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(organizationExportCaptures());
