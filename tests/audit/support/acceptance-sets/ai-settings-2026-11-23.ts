import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#527 of 2026-11-23: the Admin's „WerkFlow KI“ card
 * in the organization settings, for an organization WerkFlow has not released.
 */
function aiSettingsCaptures(): OpenSet {
  return {
    id: 'ai-settings-2026-11-23',
    captures: [
      {
        id: 'admin-einstellungen-organisation',
        role: 'admin',
        route: '/einstellungen/organisation',
        view: { kind: 'page' },
        reveal: 'WerkFlow KI ist für deine Organisation noch nicht freigeschaltet.',
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(aiSettingsCaptures());
