import type { Locator, Page } from '@playwright/test';
import { plannedQualificationsRegion } from '../../golden/support/steps/qualifications';
import { inputByValue, SHARED_COPY, visibleText } from '../../golden/support/steps/shared';

/**
 * Copy of the work template surfaces that only the P1-13 audit checks: list
 * filters, quick-create dialogs, the after-creation apply dialog and the other
 * creation contexts. The editor controls that the Golden journey shares live
 * in tests/golden/support/steps/work.ts.
 */
export const TEMPLATE_AUDIT_COPY = {
  list: {
    empty: 'Noch keine Arbeitsvorlagen',
    noMatch: 'Keine Arbeitsvorlage passt zu Suche und Filtern.',
    targetFilter: 'Ziel filtern',
    statusFilter: 'Status filtern',
    archive: 'Arbeitsvorlage archivieren',
    reactivate: 'Arbeitsvorlage reaktivieren',
  },
  filterOption: {
    onlyProjects: 'Nur Projekte',
    drafts: 'Entwürfe',
    archive: 'Archiv',
    active: 'Aktive Vorlagen',
  },
  createDialog: { nameRequired: 'Bitte gib einen Namen an.' },
  editor: { draftSaved: 'Entwurf gespeichert.' },
  material: { notes: 'Notiz' },
  quickCreate: {
    newItem: 'Neuen Artikel erstellen',
    itemDialog: 'Artikel erstellen',
    newLocation: 'Neues Lager erstellen',
    locationDialog: 'Lager erstellen',
    newCapability: 'Neue Qualifikation erstellen',
    capabilityDialog: 'Qualifikation erstellen',
    capabilityKind: 'Art der Qualifikation',
  },
  apply: {
    open: 'Vorlage anwenden',
    dialog: 'Arbeitsvorlage anwenden',
    submit: 'Anwenden',
    preview: /Aufgaben\/Checklistenpunkte/,
    alreadyApplied: 'Diese Version wurde bereits angewendet.',
    additional: 'Weitere Vorlage ergänzen. Vorhandene Planung bleibt bestehen.',
    confirmAdditional: 'Bestätige zuerst, dass du eine weitere Vorlage ergänzen möchtest.',
  },
  jobPlanning: {
    editMaterial: 'Position bearbeiten',
    materialDialog: 'Materialposition bearbeiten',
  },
  instructionMeta: { optionalTask: /Aufgabe · Optional/, evidenceExpected: /Nachweis erwartet:/ },
  picker: {
    noTemplate: /Noch keine passende Vorlage veröffentlicht\./,
    manage: 'Arbeitsvorlagen verwalten',
  },
  context: {
    employeeCreateJob: 'Auftrag erstellen',
    projectAddJob: 'Auftrag hinzufügen',
  },
  conversion: {
    referenceUnavailable: 'Die Arbeitsvorlage verweist auf nicht mehr aktive Stammdaten.',
  },
} as const;

export function visibleExactText(page: Page, text: string): Locator {
  return visibleText(page, text, true);
}

export function exactText(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true });
}

/** A dialog named by its heading. */
function dialogWithHeading(page: Page, heading: string): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: heading }) });
}

export function templateQuickCreateDialog(page: Page, kind: 'item' | 'location' | 'capability'): Locator {
  const headings = TEMPLATE_AUDIT_COPY.quickCreate;
  const heading =
    kind === 'item'
      ? headings.itemDialog
      : kind === 'location'
        ? headings.locationDialog
        : headings.capabilityDialog;
  return dialogWithHeading(page, heading);
}

export function applyTemplateDialog(page: Page): Locator {
  return dialogWithHeading(page, TEMPLATE_AUDIT_COPY.apply.dialog);
}

export function materialPositionDialog(page: Page): Locator {
  return dialogWithHeading(page, TEMPLATE_AUDIT_COPY.jobPlanning.materialDialog);
}

/** The job's button that removes this capability requirement. */
export function removeCapabilityRequirementButton(page: Page, capabilityName: string): Locator {
  return page.getByRole('button', { name: `${capabilityName} als Anforderung entfernen` });
}

/** The apply dialog's refusal that names the retired capability. */
export function retiredCapabilityRefusal(dialog: Locator, capabilityName: string): Locator {
  return dialog.getByText(
    `„${capabilityName}“ ist nicht mehr aktiv. Korrigiere die Vorlage und versuche es erneut.`,
  );
}

/** The editor item card whose name field holds exactly this text. */
export async function templateItemCard(editor: Locator, itemName: string): Promise<Locator> {
  const nameInput = await inputByValue(editor, SHARED_COPY.field.name, itemName);
  const inputId = await nameInput.getAttribute('id');
  if (!inputId?.startsWith('item-')) {
    throw new Error(`Template item "${itemName}" has no stable input id.`);
  }
  // The name field's id carries the generated item id; the card keeps it in
  // data-row-id, so the locator follows this item when the editor reorders.
  const rowId = inputId.slice('item-'.length);
  return editor.getByTestId('work-template-item').and(editor.locator(`[data-row-id="${rowId}"]`));
}

/** The item card the editor appended last; it has no name until the test fills it. */
export function appendedTemplateItemCard(editor: Locator): Locator {
  return editor.getByTestId('work-template-item').last();
}

export function templateMaterialCard(editor: Locator): Locator {
  return editor.getByTestId('work-template-material');
}

export function materialArticlePicker(materialCard: Locator): Locator {
  // The two custom selects have visible labels but do not expose an accessible name.
  return materialCard.getByRole('combobox').first();
}

export function materialLocationPicker(materialCard: Locator): Locator {
  // Article is the first custom select and preferred location is the second.
  return materialCard.getByRole('combobox').nth(1);
}

/** The capability row the editor appended last, inside „Geplante Qualifikationen“. */
export function templateQualificationRow(editor: Locator): Locator {
  return plannedQualificationsRegion(editor).getByTestId('work-template-capability').last();
}
