import { seedStoredImageDocument } from '../../../golden/support/db/documents';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet, type SetCapture } from '../acceptance-sets';
import { layoutNames, prepareLayoutDetails } from '../layout-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { prepareFieldEquipment } from '../dialog-openers/time';
import { surfaceFixture } from '../surface-fixtures';

/**
 * A photo of the Anlage's type plate, linked to the layout Anlage on the
 * employee's job, so „Verlauf und Dokumente“ shows a document beside the
 * empty history.
 */
async function seededJobPack(world: TestWorld): Promise<SurfaceDestination> {
  const equipmentId = await prepareFieldEquipment(world);
  await surfaceFixture(world, 'acceptance.equipment-field-document', () =>
    seedStoredImageDocument({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      displayName: 'Typenschild.png',
      equipmentId,
    }),
  );
  const details = await prepareLayoutDetails(world);
  return { route: `/auftraege/${details.jobNumber}`, heading: layoutNames(world).job };
}

/**
 * werk-flow/werkflow-planning#468 of 2026-11-14: the employee's work pack with
 * „Verlauf und Dokumente“ on each linked Anlage, and the dialog settled,
 * loading and failed, on a phone and a desktop.
 */
function equipmentFieldHistoryCaptures(): OpenSet {
  const both = { widths: [375, 1280], schemes: ['light', 'dark'] } as const;
  const dialog = { kind: 'dialog', opener: 'field.equipment-record' } as const;
  const id = 'employee-auftrag-dialog-equipment-record';
  return {
    id: 'equipment-field-history-2026-11-14',
    captures: [
      {
        id: 'employee-auftrag',
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: seededJobPack,
        reveal: 'Anlagen am Einsatzort',
        ...both,
      },
      {
        id,
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: dialog,
        destination: seededJobPack,
        ...both,
      },
      ...(['loading', 'error'] as const).map(
        (state): SetCapture => ({
          id: stateCaptureId(id, state),
          role: 'employee',
          route: '/auftraege/[jobNumber]',
          view: dialog,
          destination: seededJobPack,
          state,
          ...both,
        }),
      ),
    ],
    standalone: [],
  };
}

acceptanceSet(equipmentFieldHistoryCaptures());
