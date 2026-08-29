import type { Locator, Page } from '@playwright/test';
import { inputByValue } from '../../golden/support/steps';

export function visibleExactText(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true }).filter({ visible: true }).first();
}

export function exactText(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true });
}

export function visibleMatchingText(page: Page, text: RegExp): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

export async function templateItemCard(editor: Locator, itemName: string): Promise<Locator> {
  // The editor exposes item fields through labels, but no semantic group owns the whole item.
  const nameInput = await inputByValue(editor, 'Bezeichnung', itemName);
  const inputId = await nameInput.getAttribute('id');
  if (!inputId) {
    throw new Error(`Template item "${itemName}" has no stable input id.`);
  }
  // Capture the generated item identity. A positional input locator would
  // silently follow another card after the editor reorders its items.
  return editor.locator(`[data-slot="card"]:has(input#${inputId})`);
}

export function appendedTemplateItemCard(editor: Locator): Locator {
  // New editor items are appended without a stable ID or name until the test fills the field.
  return editor.getByLabel('Bezeichnung').last().locator('xpath=ancestor::*[@data-slot="card"][1]');
}

export function templateMaterialCard(editor: Locator): Locator {
  // Material cards have generated IDs, so the labelled quantity field is their stable anchor.
  return editor.getByLabel('Geplante Menge').locator('xpath=ancestor::*[@data-slot="card"][1]');
}

export function materialArticlePicker(materialCard: Locator): Locator {
  // The two custom selects have visible labels but do not expose an accessible name.
  return materialCard.getByRole('combobox').first();
}

export function materialLocationPicker(materialCard: Locator): Locator {
  // Article is the first custom select and preferred location is the second.
  return materialCard.getByRole('combobox').nth(1);
}

export function templateQualificationRow(editor: Locator): Locator {
  // Capability rows have no semantic group role or stable ID; scope the raw row to its section.
  return editor
    .getByRole('heading', { name: 'Geplante Qualifikationen', exact: true })
    .locator('xpath=ancestor::section[1]')
    .locator('.rounded-lg.border')
    .last();
}

export function instructionCard(page: Page, itemName: string): Locator {
  // Job instruction cards have no semantic container; the completion button distinguishes them.
  return page
    .getByText(itemName, { exact: true })
    .filter({ visible: true })
    .first()
    .locator('xpath=ancestor::div[.//button[contains(@aria-label,"Punkt als")]][1]');
}

export function lastInstructionDetailsButton(page: Page): Locator {
  // The flow intentionally edits the second persisted item after asserting there are exactly two.
  return page.getByRole('button', { name: 'Eintragsdetails bearbeiten' }).last();
}
