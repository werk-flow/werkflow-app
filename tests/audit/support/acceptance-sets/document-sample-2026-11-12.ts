import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#377 of 2026-11-12: „Dokumente & Briefpapier“
 * with the Musterangebot for Admin and Büro, loading and with a failed render,
 * and the employee's settings, which keep the section out.
 */
function documentSampleCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'document-sample-2026-11-12',
    captures: [
      {
        id: 'admin-einstellungen-dokumente',
        role: 'admin',
        route: '/einstellungen/dokumente',
        view: page,
        ...both,
      },
      {
        id: 'buero-einstellungen-dokumente',
        role: 'buero',
        route: '/einstellungen/dokumente',
        view: page,
        ...both,
      },
      {
        id: stateCaptureId('admin-einstellungen-dokumente', 'loading'),
        role: 'admin',
        route: '/einstellungen/dokumente',
        view: page,
        state: 'loading',
        ...both,
      },
      {
        id: stateCaptureId('admin-einstellungen-dokumente', 'error'),
        role: 'admin',
        route: '/einstellungen/dokumente',
        view: page,
        state: 'error',
        ...both,
      },
      {
        id: 'employee-einstellungen-profil',
        role: 'employee',
        route: '/einstellungen/profil',
        view: page,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(documentSampleCaptures());
