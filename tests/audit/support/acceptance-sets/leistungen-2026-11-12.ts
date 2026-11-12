import { seedLeistung } from '../../../golden/support/db/price-catalog';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

/** Three Leistungen of „Haustechnik Sonnenberg“ with made-up prices: one raised, one with a coming price, one without a cost rate. */
async function filledLeistungen(world: TestWorld): Promise<SurfaceDestination> {
  const prefix = `ACC-${world.runId}`;
  await surfaceFixture(world, 'commercial.acceptance-leistungen', async () => {
    const actor = { orgId: world.orgId, actorId: world.users.admin.id };
    await seedLeistung({
      ...actor,
      leistungNumber: `${prefix}-100`,
      name: 'Montage Heizung',
      description: 'Stundensatz Monteur, Heizungsbau',
      prices: [
        { validFrom: '2025-01-01', salePriceCents: 6200, costRateCents: 4000 },
        { validFrom: '2026-01-01', salePriceCents: 6800, costRateCents: 4300 },
        { validFrom: '2099-01-01', salePriceCents: 7400, costRateCents: 4600 },
      ],
    });
    await seedLeistung({
      ...actor,
      leistungNumber: `${prefix}-200`,
      name: 'Anfahrt Stadtgebiet',
      kind: 'anfahrt',
      unit: 'flat_rate',
      prices: [{ validFrom: '2026-01-01', salePriceCents: 3900, costRateCents: null }],
    });
    return seedLeistung({
      ...actor,
      leistungNumber: `${prefix}-300`,
      name: 'Entsorgung Altkessel',
      kind: 'gebuehr',
      unit: 'piece',
      prices: [{ validFrom: '2026-01-01', salePriceCents: 8500, costRateCents: 6000 }],
    });
  });
  return { route: `/angebote/leistungen?q=${encodeURIComponent(prefix)}` };
}

/**
 * werk-flow/werkflow-planning#379 of 2026-11-12: „Angebote“ → „Leistungen“
 * empty, filled and loading, the create dialog and the price history of one
 * Leistung, for Admin and Büro. The list's failure is a region the server
 * renders, which no browser interception can produce.
 */
type SetCapture = OpenSet['captures'][number];

function roleCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  const route = '/angebote/leistungen' as const;
  return [
    { id: `${role}-liste`, role, route, view: page, destination: filledLeistungen, ...both },
    { id: stateCaptureId(`${role}-liste`, 'loading'), role, route, view: page, state: 'loading', ...both },
    { id: `${role}-anlegen`, role, route, view: { kind: 'dialog', opener: 'commercial.leistung' }, ...both },
    {
      id: `${role}-preise`,
      role,
      route,
      view: { kind: 'dialog', opener: 'commercial.leistung-prices' },
      ...both,
    },
  ];
}

function leistungenCaptures(): OpenSet {
  return {
    id: 'leistungen-2026-11-12',
    captures: [
      // Empty runs first: the filled capture seeds the world's Leistungen.
      {
        id: 'admin-leer',
        role: 'admin',
        route: '/angebote/leistungen',
        view: { kind: 'page' },
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      ...roleCaptures('admin'),
      ...roleCaptures('buero'),
    ],
    standalone: [],
  };
}

acceptanceSet(leistungenCaptures());
