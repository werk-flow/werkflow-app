import { expect, type Locator } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import { seedRequest } from '../../../golden/support/db/requests';
import { seedPublishedWorkTemplate } from '../../../golden/support/db/work';
import { dismissDialog } from '../../../golden/support/steps/interaction';
import {
  requestCaptureButton,
  requestCaptureDialog,
  requestCloseButton,
  requestCloseDialog,
  requestConversionDialog,
  requestConvertButton,
  requestConvertToServiceButton,
  requestConvertToServiceDialog,
  requestEditButton,
  requestEditDialog,
  requestMatchCustomerButton,
  requestMatchCustomerDialog,
} from '../../../golden/support/steps/requests';
import { testData } from '../../../golden/support/steps/shared';
import {
  workTemplateCreateButton,
  workTemplateCreateDialog,
  workTemplateCreateNameField,
  workTemplateCreateSubmit,
  workTemplateDraftEditor,
  workTemplateEditorAction,
  workTemplateOpenButton,
  workTemplateSearch,
} from '../../../golden/support/steps/work';
import type { DialogOpener } from '../dialog-opener';
import {
  applyTemplateButton,
  applyTemplateDialog,
  materialArticlePicker,
  templateMaterialCard,
  templateQualificationRow,
  templateQuickCreateButton,
  templateQuickCreateDialog,
} from '../p1-13-steps';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';
import { worldName } from '../../../../lib/testing/seed-world-plan';

/**
 * Brings the editor of the audit's template draft (version 1) open on
 * /arbeitsvorlagen and returns it. The template list is cached per
 * organization and refreshes only on a manager mutation, so the draft is
 * created once per world through the create dialog, which invalidates that
 * cache, and not through the database.
 */
async function templateDraftName({ page, world }: SurfaceContext): Promise<string> {
  const name = worldName('Audit Vorlage Heizungswartung', world.runId);
  await surfaceFixture(world, 'templates.draft', async () => {
    await workTemplateCreateButton(page).click();
    const createDialog = workTemplateCreateDialog(page);
    await workTemplateCreateNameField(createDialog).fill(name);
    await workTemplateCreateSubmit(createDialog).click();
    // A created draft opens in its editor; close it so the opener starts from the list.
    const editor = workTemplateDraftEditor(page, 1);
    await expect(editor).toBeVisible();
    // Focus sits in the editor's first field, so the layer helper presses Escape into it.
    await dismissDialog(editor);
    return name;
  });
  await workTemplateSearch(page).fill(name);
  return name;
}

async function openTemplateDraftEditor(context: SurfaceContext): Promise<Locator> {
  await templateDraftName(context);
  await workTemplateOpenButton(context.page).click();
  const editor = workTemplateDraftEditor(context.page, 1);
  await expect(editor).toBeVisible();
  return editor;
}

export const REQUESTS_OPENERS = {
  'requests.create': {
    trigger: async ({ page }) => requestCaptureButton(page),
    layer: requestCaptureDialog,
  },
  'requests.edit': {
    trigger: async ({ page }) => requestEditButton(page),
    layer: requestEditDialog,
  },
  'requests.close': {
    trigger: async ({ page }) => requestCloseButton(page),
    layer: requestCloseDialog,
  },
  'requests.convert': {
    trigger: async ({ page }) => requestConvertButton(page),
    layer: requestConversionDialog,
  },
  'requests.convert-to-service': {
    // The layout request has a customer and a site, so the takeover is offered.
    trigger: async ({ page }) => requestConvertToServiceButton(page),
    layer: requestConvertToServiceDialog,
  },
  'requests.assign-customer': {
    // Only a request without a customer offers the match, so the opener opens its own.
    trigger: async ({ page, world }) => {
      const requestId = await surfaceFixture(world, 'requests.unassigned', () =>
        seedRequest({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          summary: worldName('Audit Anfrage ohne Kundenzuordnung', world.runId),
          requestNumber: testData`AUDIT-ANF-${world.runId}-OHNE`,
          callerName: 'Erika Mustermann',
          callerPhone: '030 1234567',
        }),
      );
      await page.goto(`/anfragen/${requestId}`);
      return requestMatchCustomerButton(page);
    },
    layer: requestMatchCustomerDialog,
  },
  'templates.apply': {
    // The picker reads published versions uncached, so a database seed shows at once.
    trigger: async ({ page, world }) => {
      await surfaceFixture(world, 'templates.published', async () => {
        const { templateId } = await seedPublishedWorkTemplate({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          name: worldName('Audit Vorlage Inbetriebnahme', world.runId),
          targetType: 'job',
          items: [{ content: 'Anlage prüfen' }, { content: 'Inbetriebnahme dokumentieren' }],
        });
        return templateId;
      });
      return applyTemplateButton(page);
    },
    layer: applyTemplateDialog,
  },
  'templates.create': {
    trigger: async ({ page }) => workTemplateCreateButton(page),
    layer: workTemplateCreateDialog,
  },
  'templates.editor': {
    trigger: async (context) => {
      await templateDraftName(context);
      return workTemplateOpenButton(context.page);
    },
    layer: (page) => workTemplateDraftEditor(page, 1),
  },
  'templates.create-capability': {
    trigger: async (context) => {
      const editor = await openTemplateDraftEditor(context);
      await workTemplateEditorAction(editor, 'addCapability', { exact: true }).click();
      await templateQualificationRow(editor).getByRole('combobox').click();
      return templateQuickCreateButton(context.page, 'capability');
    },
    layer: (page) => templateQuickCreateDialog(page, 'capability'),
    // The create action sits in the closed picker popup; the picker's combobox is the next owner of focus.
    returnFocus: ({ page }) =>
      templateQualificationRow(workTemplateDraftEditor(page, 1)).getByRole('combobox'),
    parents: (page) => [workTemplateDraftEditor(page, 1)],
  },
  'templates.create-material': {
    trigger: async (context) => {
      const editor = await openTemplateDraftEditor(context);
      await workTemplateEditorAction(editor, 'addMaterial', { exact: true }).click();
      await materialArticlePicker(templateMaterialCard(editor)).click();
      return templateQuickCreateButton(context.page, 'item');
    },
    layer: (page) => templateQuickCreateDialog(page, 'item'),
    returnFocus: ({ page }) => materialArticlePicker(templateMaterialCard(workTemplateDraftEditor(page, 1))),
    parents: (page) => [workTemplateDraftEditor(page, 1)],
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
