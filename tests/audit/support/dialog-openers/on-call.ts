import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import { seedRunningOnCallShift } from '../../../golden/support/db/on-call';
import {
  onCallDialog,
  onCallEndConfirmation,
  onCallHeaderButton,
  onCallRowActions,
  onCallRowMenuItem,
} from '../../../golden/support/steps/on-call';
import type { DialogOpener } from '../dialog-opener';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';

/** One running shift of the employee, which the handover, the history and the end need. Returns its id. */
function prepareRunningShift({ world }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'service.on-call-running', () =>
    seedRunningOnCallShift({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      memberUserId: world.users.employee.id,
      label: 'Heizung',
      handoverNote: 'Schlüssel liegt im Fahrzeug.',
    }),
  );
}

/** Opens the row menu of the running shift and returns the item. */
async function rowMenuItem(context: SurfaceContext, action: 'end' | 'history') {
  const shiftId = await prepareRunningShift(context);
  await context.page.goto('/service/bereitschaft');
  await onCallRowActions(context.page, shiftId).click();
  return onCallRowMenuItem(context.page, action);
}

export const ON_CALL_OPENERS = {
  'service.on-call-plan': {
    trigger: async ({ page }) => onCallHeaderButton(page, 'plan'),
    layer: (page) => onCallDialog(page, 'plan'),
  },
  'service.on-call-handover': {
    trigger: async (context) => {
      await prepareRunningShift(context);
      await context.page.goto('/service/bereitschaft');
      return onCallHeaderButton(context.page, 'handOver');
    },
    layer: (page) => onCallDialog(page, 'handOver'),
  },
  'service.on-call-history': {
    trigger: (context) => rowMenuItem(context, 'history'),
    layer: (page) => onCallDialog(page, 'history'),
    returnFocus: ({ page }) => page.getByRole('button', { name: 'Aktionen öffnen' }).first(),
  },
  'service.on-call-end': {
    trigger: (context) => rowMenuItem(context, 'end'),
    layer: onCallEndConfirmation,
    returnFocus: ({ page }) => page.getByRole('button', { name: 'Aktionen öffnen' }).first(),
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
