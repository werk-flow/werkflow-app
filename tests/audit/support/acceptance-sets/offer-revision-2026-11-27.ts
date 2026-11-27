import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { seedRevisedOffer, type OfferRevisionStage } from '../../../golden/support/db/offer-revisions';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const TITLES: Record<OfferRevisionStage, string> = {
  sent: 'Heizungswartung',
  editing: 'Wartung Brennwerttherme',
  superseded: 'Heizungstausch',
};

function offerPage(stage: OfferRevisionStage) {
  return async (world: TestWorld): Promise<SurfaceDestination> => {
    const offerId = await surfaceFixture(world, `commercial.acceptance-offer-revision-${stage}`, () =>
      seedRevisedOffer(world, TITLES[stage], stage),
    );
    return { route: `/angebote/${offerId}`, heading: `${TITLES[stage]} ${world.runId}` };
  };
}

type SetCapture = OpenSet['captures'][number];

/**
 * werk-flow/werkflow-planning#582 of 2026-11-27: a sent offer with
 * „Bearbeiten“ and its confirmation, the same offer as the draft of revision
 * 2 with the sentence which revision counts, and an offer whose revision 2 was
 * sent, with revision 1 replaced, for Admin and Büro. The pages before the
 * change are `offer-sending-2026-11-26`'s `<role>-revisionen` and `<role>-abgelaufen`.
 */
function roleCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const route = '/angebote/[offerId]' as const;
  const sent = { role, route, destination: offerPage('sent'), ...both } as const;
  return [
    { id: `${role}-gesendet`, ...sent, view: { kind: 'page' } },
    { id: `${role}-bearbeiten`, ...sent, view: { kind: 'dialog', opener: 'commercial.offer-revision' } },
    {
      id: `${role}-entwurf-revision-2`,
      role,
      route,
      destination: offerPage('editing'),
      view: { kind: 'page' },
      reveal: 'Du bearbeitest Revision 2. Bis du sie als gesendet festhältst, gilt Revision 1.',
      ...both,
    },
    {
      id: `${role}-ersetzt`,
      role,
      route,
      destination: offerPage('superseded'),
      view: { kind: 'page' },
      reveal: 'Ersetzt durch Revision 2',
      ...both,
    },
  ];
}

acceptanceSet({
  id: 'offer-revision-2026-11-27',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
