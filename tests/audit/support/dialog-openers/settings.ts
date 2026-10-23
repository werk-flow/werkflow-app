import { expect } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import {
  answerNextFileChooserWithAvatar,
  createOrganizationButton,
  createOrganizationDialog,
  deleteOrganizationButton,
  deleteOrganizationConfirmation,
  joinOrganizationButton,
  joinOrganizationDialog,
  profileAvatarDialog,
  profileAvatarUploadButton,
} from '../../../golden/support/steps/organization';
import {
  addDelegationButton,
  changeResponsibilityButton,
  onboardingTemplateButton,
  onboardingTemplateDialog,
  responsibilityCard,
  responsibilityChangeDialog,
  responsibilityDelegationDialog,
} from '../../../golden/support/steps/personnel';
import type { DialogOpener } from '../dialog-opener';

/** The responsibility whose card the settings openers use; every card has both dialogs. */
const RESPONSIBILITY = 'time_approval';

export const SETTINGS_OPENERS = {
  'settings.avatar': {
    // The dialog opens on a chosen file. The upload button opens the native
    // file chooser, which the page answers with a small PNG, so Enter on the
    // button walks the real keyboard path to the crop dialog.
    trigger: async ({ page }) => {
      answerNextFileChooserWithAvatar(page);
      return profileAvatarUploadButton(page);
    },
    layer: profileAvatarDialog,
  },
  'settings.create-org': {
    opensOn: 'desktop',
    phonePath:
      'The phone menu (Menü öffnen) holds the same organization switcher with this button (components/sidebar/app-shell.tsx).',
    trigger: async ({ page }) => createOrganizationButton(page),
    layer: createOrganizationDialog,
  },
  'settings.join-org': {
    opensOn: 'desktop',
    phonePath:
      'The phone menu (Menü öffnen) holds the same organization switcher with this button (components/sidebar/app-shell.tsx).',
    trigger: async ({ page }) => joinOrganizationButton(page),
    layer: joinOrganizationDialog,
  },
  'settings.delete-org': {
    trigger: async ({ page }) => {
      const button = deleteOrganizationButton(page);
      await expect(button).toBeEnabled();
      return button;
    },
    layer: deleteOrganizationConfirmation,
  },
  'settings.onboarding-template': {
    trigger: async ({ page }) => {
      const button = onboardingTemplateButton(page);
      await expect(button).toBeEnabled();
      return button;
    },
    layer: onboardingTemplateDialog,
  },
  'settings.responsibility': {
    trigger: async ({ page }) => changeResponsibilityButton(responsibilityCard(page, RESPONSIBILITY)),
    layer: (page) => responsibilityChangeDialog(page, RESPONSIBILITY),
  },
  'settings.delegation': {
    trigger: async ({ page }) => addDelegationButton(responsibilityCard(page, RESPONSIBILITY)),
    layer: (page) => responsibilityDelegationDialog(page, RESPONSIBILITY),
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
