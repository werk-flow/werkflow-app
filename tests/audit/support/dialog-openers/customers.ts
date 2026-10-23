import { expect } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import { seedDoNotContactPolicy } from '../../../golden/support/db/customers';
import { seedJob } from '../../../golden/support/db/work';
import { shiftIsoDate } from '../../../golden/support/plantafel';
import {
  addContactButton,
  addCustomerButton,
  addPreferenceButton,
  addSiteButton,
  communicationPreferenceDialog,
  communicationSettingsButton,
  communicationSettingsDialog,
  contactWarningDialog,
  createFollowUpButton,
  customerContactDialog,
  customerContactLink,
  customerCreateDialog,
  customerDeleteConfirmation,
  customerDeleteMenuItem,
  customerDetailFieldLabel,
  customerDetailsRegion,
  customerEditDialog,
  customerRowActionsButton,
  customerRowDeleteItem,
  customerRowEditItem,
  customerSiteDialog,
  followUpDialog,
} from '../../../golden/support/steps/customers';
import {
  detailActionsButton,
  metadataDiscardConfirmation,
  metadataEditButton,
  metadataField,
} from '../../../golden/support/steps/shared';
import { plannedDateControl, plannedDateRemovalConfirmation } from '../../../golden/support/steps/work';
import type { DialogOpener } from '../dialog-opener';
import { layoutNames, prepareLayoutDetails } from '../layout-fixtures';
import { surfaceFixture } from '../surface-fixtures';
import { openSurface } from '../surface-routes';

/** The phone number of the contact whose call conflicts with the customer's do-not-contact instruction. */
const GUARDED_CONTACT_PHONE = '030 5550123';

export const CUSTOMERS_OPENERS = {
  'customers.create': {
    trigger: async ({ page }) => addCustomerButton(page),
    layer: customerCreateDialog,
  },
  'customers.list-delete': {
    opensOn: 'desktop',
    phonePath:
      'The phone card of the customer list holds the same actions menu (ClientCard, components/kunden/clients-table.tsx).',
    trigger: async ({ page, world }) => {
      await prepareLayoutDetails(world);
      await page.reload();
      const menu = customerRowActionsButton(page, layoutNames(world).client);
      await menu.click();
      return customerRowDeleteItem(page);
    },
    layer: customerDeleteConfirmation,
    returnFocus: ({ page, world }) => customerRowActionsButton(page, layoutNames(world).client),
  },
  // The edit dialog lives in the list's row menu only; the detail page has no edit action.
  'customers.edit': {
    opensOn: 'desktop',
    phonePath:
      'The phone card of the customer list holds the same actions menu (ClientCard, components/kunden/clients-table.tsx).',
    trigger: async ({ page, world }) => {
      await prepareLayoutDetails(world);
      await page.reload();
      const menu = customerRowActionsButton(page, layoutNames(world).client);
      await menu.click();
      return customerRowEditItem(page);
    },
    layer: customerEditDialog,
    returnFocus: ({ page, world }) => customerRowActionsButton(page, layoutNames(world).client),
  },
  'customers.delete': {
    trigger: async ({ page }) => {
      await detailActionsButton(page).click();
      return customerDeleteMenuItem(page);
    },
    layer: customerDeleteConfirmation,
    returnFocus: ({ page }) => detailActionsButton(page),
  },
  'customers.contact': {
    trigger: async ({ page }) => addContactButton(page),
    layer: customerContactDialog,
  },
  'customers.site': {
    trigger: async ({ page }) => addSiteButton(page),
    layer: customerSiteDialog,
  },
  'customers.communication-settings': {
    trigger: async ({ page }) => communicationSettingsButton(page),
    layer: communicationSettingsDialog,
  },
  'customers.preference': {
    trigger: async ({ page }) => addPreferenceButton(page),
    layer: communicationPreferenceDialog,
  },
  'customers.follow-up': {
    trigger: async ({ page }) => createFollowUpButton(page),
    layer: followUpDialog,
  },
  // A do-not-contact instruction makes the call link ask first; the check is a
  // read, and the warning opens before anything is written.
  'customers.contact-guard': {
    trigger: async ({ page, world }) => {
      const { clientId } = await prepareLayoutDetails(world);
      await surfaceFixture(world, 'customers.do-not-contact', () =>
        seedDoNotContactPolicy({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          clientId,
          contact: { name: `Layout Ansprechpartner ${world.runId}`, phone: GUARDED_CONTACT_PHONE },
          instruction: 'Bitte nur nach schriftlicher Terminabsprache anrufen.',
        }),
      );
      await page.reload();
      const link = customerContactLink(page, GUARDED_CONTACT_PHONE);
      await expect(link).toBeVisible();
      return link;
    },
    layer: contactWarningDialog,
  },
  // Unsaved changes in one row, then the pencil of another row asks before discarding them.
  'shared.metadata-discard': {
    trigger: async ({ page, world }) => {
      const details = customerDetailsRegion(page);
      const name = customerDetailFieldLabel('name');
      await metadataEditButton(details, name).click();
      await metadataField(details, name)
        .getByRole('textbox')
        .fill(`${layoutNames(world).client} geändert`);
      return metadataEditButton(details, customerDetailFieldLabel('phone'));
    },
    layer: metadataDiscardConfirmation,
  },
  // Only the job's planned date asks before saving (removing it). The layout
  // job is unplanned, so the opener seeds its own planned job, far from the
  // business week so the planning views of the world stay as they are, and
  // opens that job's page.
  'shared.metadata-confirm': {
    trigger: async ({ page, world, businessDate }) => {
      const title = `Layout Wartung mit geplantem Datum ${world.runId}`;
      const jobNumber = await surfaceFixture(world, 'shared.planned-job', async () => {
        const number = `AUF-${world.runId}-LAYOUT-DATUM`;
        await seedJob({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          jobNumber: number,
          title,
          plannedDate: shiftIsoDate(businessDate, 120),
        });
        return number;
      });
      await openSurface(page, { route: `/auftraege/${jobNumber}`, heading: title });
      await plannedDateControl(page, 'edit').click();
      await plannedDateControl(page, 'clear').click();
      return plannedDateControl(page, 'save');
    },
    layer: plannedDateRemovalConfirmation,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
