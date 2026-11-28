import { convertedJobNumber, seedConvertedOffer } from '../../../golden/support/db/offer-conversions';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type SetCapture } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

// An offer of its own, so no other set or opener shares its name or number.
const TITLE = 'Heizungsmodernisierung Lärchenweg';

const converted = (world: TestWorld) =>
  surfaceFixture(world, 'acceptance.offer-conversion', () => seedConvertedOffer(world, TITLE));

async function convertedOfferPage(world: TestWorld): Promise<SurfaceDestination> {
  const offerId = await converted(world);
  return { route: `/angebote/${offerId}`, heading: `${TITLE} ${world.runId}` };
}

async function convertedJobPage(world: TestWorld): Promise<SurfaceDestination> {
  const jobNumber = await convertedJobNumber(world, await converted(world));
  return { route: `/auftraege/${jobNumber}`, heading: `${TITLE} ${world.runId}` };
}

const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;

/**
 * werk-flow/werkflow-planning#388 of 2026-11-28: „In Arbeit übernehmen“ on an
 * accepted offer (the accepted offer before the change is
 * `offer-acceptance-2026-11-28`'s `<role>-angenommen`), the offer linked to
 * its job afterwards, the job's priced „Auftragsumfang“ for Admin and Büro,
 * and the field worker's „Auftragsumfang“ in the work pack without a price,
 * each also loading and failed. A job without an order shows no such section:
 * the work pack and job page references stay its empty state.
 */
function officeCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const dialog = { kind: 'dialog', opener: 'commercial.offer-conversion' } as const;
  const offerRoute = '/angebote/[offerId]' as const;
  const jobRoute = '/auftraege/[jobNumber]' as const;
  return [
    { id: `${role}-in-arbeit-uebernehmen`, role, route: offerRoute, view: dialog, ...both },
    {
      id: `${role}-angebot-in-arbeit`,
      role,
      route: offerRoute,
      destination: convertedOfferPage,
      view: { kind: 'page' },
      ...both,
    },
    {
      id: `${role}-auftrag-auftragsumfang`,
      role,
      route: jobRoute,
      destination: convertedJobPage,
      view: { kind: 'page' },
      reveal: 'Auftragsumfang',
      ...both,
    },
    ...(['loading', 'error'] as const).map(
      (state): SetCapture => ({
        id: stateCaptureId(`${role}-auftrag-auftragsumfang`, state),
        role,
        route: jobRoute,
        destination: convertedJobPage,
        view: { kind: 'page' },
        state,
        ...both,
      }),
    ),
  ];
}

const employeeCaptures: SetCapture[] = [
  {
    id: 'employee-auftrag-auftragsumfang',
    role: 'employee',
    route: '/auftraege/[jobNumber]',
    destination: convertedJobPage,
    view: { kind: 'page' },
    reveal: 'Auftragsumfang',
    ...both,
  },
  ...(['loading', 'error'] as const).map(
    (state): SetCapture => ({
      id: stateCaptureId('employee-auftrag-auftragsumfang', state),
      role: 'employee',
      route: '/auftraege/[jobNumber]',
      destination: convertedJobPage,
      view: { kind: 'page' },
      state,
      ...both,
    }),
  ),
];

acceptanceSet({
  id: 'offer-conversion-2026-11-28',
  captures: [...officeCaptures('admin'), ...officeCaptures('buero'), ...employeeCaptures],
  standalone: [],
});
