import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { seedDecidedOffer, type OfferDecisionStage } from '../../../golden/support/db/offer-decisions';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

// The open and accepted offers are the dialog openers' (commercial.offer-decision-<stage>).
const TITLES: Record<OfferDecisionStage, string> = {
  offen: 'Heizungsmodernisierung Zedernhof',
  angenommen: 'Heizungsmodernisierung Mispelweg',
  abgelehnt: 'Heizungsmodernisierung Quittenweg',
  zurueckgezogen: 'Heizungsmodernisierung Holunderweg',
};

function offerPage(stage: OfferDecisionStage) {
  return async (world: TestWorld): Promise<SurfaceDestination> => {
    const offerId = await surfaceFixture(world, `commercial.offer-decision-${stage}`, () =>
      seedDecidedOffer(world, TITLES[stage], stage),
    );
    return { route: `/angebote/${offerId}`, heading: `${TITLES[stage]} ${world.runId}` };
  };
}

type SetCapture = OpenSet['captures'][number];

/**
 * werk-flow/werkflow-planning#385 of 2026-11-28: a sent offer with „Annahme
 * erfassen“, „Ablehnung erfassen“ and „Zurückziehen“, the Annahme dialog with
 * its Bedarfs- and Alternativposition, an accepted offer with its frozen
 * Auftragsumfang, and a rejected and a withdrawn offer, for Admin and Büro.
 * The sent page before the change is `offer-revision-2026-11-27`'s `<role>-gesendet`.
 */
function roleCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const route = '/angebote/[offerId]' as const;
  const page = (stage: OfferDecisionStage) =>
    ({ role, route, destination: offerPage(stage), ...both }) as const;
  return [
    { id: `${role}-gesendet`, ...page('offen'), view: { kind: 'page' } },
    {
      id: `${role}-annahme-erfassen`,
      ...page('offen'),
      view: { kind: 'dialog', opener: 'commercial.offer-acceptance' },
    },
    { id: `${role}-angenommen`, ...page('angenommen'), view: { kind: 'page' }, reveal: 'Auftragsumfang' },
    { id: `${role}-abgelehnt`, ...page('abgelehnt'), view: { kind: 'page' } },
    { id: `${role}-zurueckgezogen`, ...page('zurueckgezogen'), view: { kind: 'page' } },
  ];
}

acceptanceSet({
  id: 'offer-acceptance-2026-11-28',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
