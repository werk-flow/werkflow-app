import { expect, type Locator, type Page } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import { randomUUID } from 'node:crypto';
import { seedArticleWithTerms, seedBookedImportBatch } from '../../../golden/support/db/inventory';
import {
  createItemButton,
  createLocationButton,
  csvImportButton,
  csvImportButtonOf,
  csvImportFileButton,
  csvImportRepeatChecked,
  inventoryImportFileInput,
  inventoryDialogLayer,
  inventoryItemRow,
  inventoryRowActionItem,
  inventoryRowActionsButton,
  itemDialogPicker,
  itemDialogPickerCreateAction,
  materialPlanButton,
  materialPlanLayer,
  wholesalerImportButton,
} from '../../../golden/support/steps/inventory';
import { confirmed, openMenuItem } from '../../../golden/support/steps/shared';
import { seedLeistung } from '../../../golden/support/db/price-catalog';
import {
  createLeistungButton,
  leistungDialogLayer,
  leistungPriceDialogLayer,
  leistungRow,
  leistungRowActionItem,
  leistungRowActionsButton,
} from '../../../golden/support/steps/angebote';
import { worldName } from '../../../../lib/testing/seed-world-plan';
import type { DialogOpener } from '../dialog-opener';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';
import { invoiceDeliverySeed, parseDeliverySeed } from '../invoice-delivery-fixtures';
import { offerDeliverySeed, parseOfferDeliverySeed } from '../offer-delivery-fixtures';
import { invoiceChainSeed, parseInvoiceChain } from '../invoice-chain-fixtures';
import { seedRevisedOffer } from '../../../golden/support/db/offer-revisions';
import { seedDecidedOffer, type OfferDecisionStage } from '../../../golden/support/db/offer-decisions';
import type { TestWorld } from '../../../golden/support/world';

type ItemDialogPicker = Parameters<typeof itemDialogPicker>[1];

/** An issued invoice that was never sent, opened unless it is the page already, and its „Versand“ action. */
async function invoiceDeliveryButton(
  { page, world }: SurfaceContext,
  name: 'Per E-Mail senden' | 'Als manuell versendet markieren',
): Promise<Locator> {
  const seed = invoiceDeliverySeed(world, 'fresh');
  const { id } = parseDeliverySeed(await surfaceFixture(world, seed.name, seed.create));
  if (!page.url().endsWith(`/rechnungen/${id}`)) await page.goto(`/rechnungen/${id}`);
  return page.getByRole('main').getByRole('button', { name, exact: true });
}

/**
 * The newest revision's „Versenden“ on the open offer, as on a sent offer an
 * acceptance set opened; else on the world's offer sent twice.
 */
async function offerDeliveryButton({ page, world }: SurfaceContext): Promise<Locator> {
  const button = page.getByRole('main').getByRole('button', { name: 'Versenden', exact: true });
  if (/\/angebote\/[0-9a-f-]{36}$/.test(page.url()) && (await button.count()) === 1) return button;
  const seed = offerDeliverySeed(world, 'fresh');
  const { id } = parseOfferDeliverySeed(await surfaceFixture(world, seed.name, seed.create));
  await page.goto(`/angebote/${id}`);
  return button;
}

function offerDeliveryLayer(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Angebot versenden', exact: true });
}

/** The world's issued invoice, opened unless it is the page already, and its header action. */
async function issuedInvoiceButton(page: Page, world: TestWorld, name: 'Stornieren' | 'Korrigieren') {
  const seed = invoiceChainSeed(world, 'issued');
  const { originalId } = parseInvoiceChain(await surfaceFixture(world, seed.name, seed.create));
  if (!page.url().endsWith(`/rechnungen/${originalId}`)) await page.goto(`/rechnungen/${originalId}`);
  return page.getByRole('main').getByRole('button', { name, exact: true });
}

function itemCreateLayer(page: Page): Locator {
  return inventoryDialogLayer(page, 'createItem');
}

/** Opens „Artikel anlegen“, then the picker, and returns the picker's create action. */
async function itemPickerCreateAction({ page }: SurfaceContext, picker: ItemDialogPicker): Promise<Locator> {
  await createItemButton(page).click();
  const dialog = itemCreateLayer(page);
  await expect(dialog).toBeVisible();
  await itemDialogPicker(dialog, picker).click();
  return itemDialogPickerCreateAction(page, picker);
}

/** The menu button of the world's seeded inventory item: in its row, or on its card on a phone. */
function seededItemActionsButton({ page, world }: SurfaceContext): Locator {
  return inventoryRowActionsButton(inventoryItemRow(page, world.inventory.itemName));
}

function importLayer(page: Page): Locator {
  return inventoryDialogLayer(page, 'importCsv');
}

/**
 * A synthetic file whose headers the dialog maps by itself: a new article, a
 * second row of the same Artikelnummer in another unit, and a row with a unit
 * outside the list. A fresh suffix keeps each file new to the repeat check.
 */
function importFile(rows: 'mixed' | 'header-only') {
  const suffix = randomUUID().slice(0, 8);
  const header = 'Artikelname;Artikelnummer;Lager;Bestand;Einheit';
  const lines =
    rows === 'header-only'
      ? [header]
      : [
          header,
          `Kupferrohr 15 mm;NR-${suffix};Hauptlager Nord;25;Meter`,
          `Kupferrohr 15 mm Stange;NR-${suffix};Hauptlager Nord;5;Stück`,
          `Pressfitting 15 mm;PF-${suffix};Hauptlager Nord;40;Stk`,
          `Dichtband;DB-${suffix};Hauptlager Nord;3;Fass`,
        ];
  return { name: `nordrohr-${suffix}.csv`, mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) };
}

/** Opens the import dialog and chooses the file; returns the open dialog. */
async function importWithFile(page: Page, file: ReturnType<typeof importFile>): Promise<Locator> {
  await csvImportButton(page).click();
  const dialog = importLayer(page);
  await expect(dialog).toBeVisible();
  await inventoryImportFileInput(dialog).setInputFiles(file);
  return dialog;
}

function seededArticleName(context: SurfaceContext): string {
  return worldName('Mehrschichtverbundrohr 16 mm', context.world.runId);
}

/** One article with two suppliers and a price history, and the catalog narrowed to it. */
async function prepareSeededArticle(context: SurfaceContext): Promise<void> {
  const { world, page } = context;
  const name = seededArticleName(context);
  await surfaceFixture(world, 'inventory.article-terms', () =>
    seedArticleWithTerms({ orgId: world.orgId, actorId: world.users.admin.id, name }),
  );
  await page.goto(`/inventar?search=${encodeURIComponent(name)}`);
}

/** The seeded article's „Artikel bearbeiten“, open. */
async function openSeededArticle(context: SurfaceContext): Promise<Locator> {
  const { page } = context;
  await prepareSeededArticle(context);
  const editItem = await openMenuItem(
    seededArticleActionsButton(context),
    inventoryRowActionItem(page, 'edit'),
  );
  await editItem.click();
  const dialog = editItemLayer(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

function seededArticleActionsButton(context: SurfaceContext): Locator {
  return inventoryRowActionsButton(inventoryItemRow(context.page, seededArticleName(context)));
}

function editItemLayer(page: Page): Locator {
  return inventoryDialogLayer(page, 'editItem');
}

/** The open article dialog on one of its tabs, for the tab's own capture. */
async function articleTab(context: SurfaceContext, tab: 'Lieferanten' | 'Preise'): Promise<Locator> {
  const dialog = await openSeededArticle(context);
  return dialog.getByRole('tab', { name: tab, exact: true });
}

/** A button of one supplier's row in the article dialog's „Lieferanten“. */
function supplierRowButton(dialog: Locator, supplier: string, action: 'Bearbeiten' | 'Entfernen'): Locator {
  return confirmed(dialog.getByRole('listitem').filter({ hasText: supplier })).getByRole('button', {
    name: action,
    exact: true,
  });
}

/** Each state of the import dialog opens from the step button that leads to it; Escape returns to „CSV importieren“. */
const importStateReturnFocus = ({ page }: SurfaceContext) => csvImportButton(page);

export const INVENTORY_OPENERS = {
  'inventory.create-location': {
    trigger: (context) => itemPickerCreateAction(context, 'location'),
    layer: (page) => inventoryDialogLayer(page, 'quickCreateLocation'),
    returnFocus: ({ page }) => itemDialogPicker(itemCreateLayer(page), 'location'),
    parents: (page) => [itemCreateLayer(page)],
  },
  'inventory.create-supplier': {
    trigger: (context) => itemPickerCreateAction(context, 'supplier'),
    layer: (page) => inventoryDialogLayer(page, 'quickCreateSupplier'),
    returnFocus: ({ page }) => itemDialogPicker(itemCreateLayer(page), 'supplier'),
    parents: (page) => [itemCreateLayer(page)],
  },
  'inventory.wholesaler-import': {
    trigger: async ({ page }) => wholesalerImportButton(page),
    layer: (page) => inventoryDialogLayer(page, 'importWholesaler'),
  },
  'inventory.import': {
    trigger: async ({ page }) => csvImportButton(page),
    layer: (page) => inventoryDialogLayer(page, 'importCsv'),
  },
  'inventory.import-preview': {
    trigger: async ({ page }) => {
      const dialog = await importWithFile(page, importFile('mixed'));
      // The preview waits for the repeat check of the chosen file.
      await expect(csvImportRepeatChecked(dialog)).toBeVisible();
      return csvImportButtonOf(dialog, 'importPreview');
    },
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.import-result': {
    trigger: async ({ page }) => {
      const dialog = await importWithFile(page, importFile('mixed'));
      await expect(csvImportRepeatChecked(dialog)).toBeVisible();
      await csvImportButtonOf(dialog, 'importPreview').click();
      return csvImportButtonOf(dialog, 'importBook');
    },
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.import-repeat': {
    trigger: async ({ page, world }) => {
      const file = importFile('mixed');
      await seedBookedImportBatch({
        orgId: world.orgId,
        actorId: world.users.buero.id,
        fileName: file.name,
        content: file.buffer,
      });
      const dialog = await importWithFile(page, file);
      await expect(csvImportButtonOf(dialog, 'importRepeatConfirm')).toBeVisible();
      // The warning shows before any submit; Enter on the file choice keeps focus on the first control.
      return csvImportFileButton(dialog);
    },
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.import-empty-file': {
    trigger: async ({ page }) =>
      csvImportButtonOf(await importWithFile(page, importFile('header-only')), 'importPreview'),
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.import-read-failure': {
    trigger: async ({ page }) => {
      // The browser cannot read the chosen file, as with a file removed after the choice.
      await page.evaluate(() => {
        File.prototype.arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
      });
      return csvImportButtonOf(await importWithFile(page, importFile('mixed')), 'importPreview');
    },
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.item': {
    trigger: async ({ page }) => createItemButton(page),
    layer: itemCreateLayer,
  },
  'inventory.item-edit': {
    trigger: async (context) => {
      await prepareSeededArticle(context);
      return openMenuItem(seededArticleActionsButton(context), inventoryRowActionItem(context.page, 'edit'));
    },
    layer: editItemLayer,
    returnFocus: seededArticleActionsButton,
  },
  // The tab triggers open their tab in the open dialog: the captures of „Lieferanten“ and „Preise“.
  'inventory.item-suppliers': {
    trigger: (context) => articleTab(context, 'Lieferanten'),
    layer: editItemLayer,
    returnFocus: seededArticleActionsButton,
  },
  'inventory.item-prices': {
    trigger: (context) => articleTab(context, 'Preise'),
    layer: editItemLayer,
    returnFocus: seededArticleActionsButton,
  },
  'inventory.article-supplier': {
    trigger: async (context) => {
      const dialog = await openSeededArticle(context);
      await dialog.getByRole('tab', { name: 'Lieferanten', exact: true }).click();
      return supplierRowButton(dialog, 'Großhandel Nordrohr', 'Bearbeiten');
    },
    layer: (page) => page.getByRole('dialog', { name: 'Lieferant bearbeiten', exact: true }),
    returnFocus: ({ page }) => supplierRowButton(editItemLayer(page), 'Großhandel Nordrohr', 'Bearbeiten'),
    parents: (page) => [editItemLayer(page)],
  },
  'inventory.article-supplier-remove': {
    trigger: async (context) => {
      const dialog = await openSeededArticle(context);
      await dialog.getByRole('tab', { name: 'Lieferanten', exact: true }).click();
      return supplierRowButton(dialog, 'Großhandel Südrohr', 'Entfernen');
    },
    layer: (page) => page.getByRole('alertdialog', { name: /^Lieferant „.+“ entfernen\?$/ }),
    returnFocus: ({ page }) => supplierRowButton(editItemLayer(page), 'Großhandel Südrohr', 'Entfernen'),
    parents: (page) => [editItemLayer(page)],
  },
  'inventory.job-materials': {
    trigger: async ({ page }) => {
      // The plan action stays disabled while the organization has no items.
      const button = materialPlanButton(page);
      await expect(button).toBeEnabled();
      return button;
    },
    layer: materialPlanLayer,
  },
  'inventory.location': {
    trigger: async ({ page }) => createLocationButton(page),
    layer: (page) => inventoryDialogLayer(page, 'createLocation'),
  },
  'inventory.stock-adjustment': {
    trigger: (context) =>
      openMenuItem(seededItemActionsButton(context), inventoryRowActionItem(context.page, 'adjustStock')),
    layer: (page) => inventoryDialogLayer(page, 'adjustStock'),
    returnFocus: seededItemActionsButton,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;

function seededLeistungName(context: SurfaceContext): string {
  return worldName('Layout Montage Heizung', context.world.runId);
}

/** One Leistung with a past, a current and a coming price, so the history shows every state. */
async function prepareLeistung(context: SurfaceContext): Promise<string> {
  const { world, page } = context;
  const name = seededLeistungName(context);
  await surfaceFixture(world, 'commercial.leistung', () =>
    seedLeistung({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      leistungNumber: `L-${world.runId}`,
      name,
      description: 'Stundensatz Monteur',
      prices: [
        { validFrom: '2020-01-01', salePriceCents: 6200, costRateCents: 4000 },
        { validFrom: '2021-01-01', salePriceCents: 6500, costRateCents: 4200 },
        { validFrom: '2099-01-01', salePriceCents: 7500, costRateCents: 4600 },
      ],
    }),
  );
  // The search narrows the list to this world's Leistung.
  await page.goto(`/angebote/leistungen?q=${encodeURIComponent(`L-${world.runId}`)}`);
  return name;
}

function seededRowActionsButton(context: SurfaceContext) {
  return leistungRowActionsButton(leistungRow(context.page, seededLeistungName(context)));
}

/**
 * A decision step's button on a sent offer of the stage, as on the offer an
 * acceptance set opened; else on the world's offer of that stage.
 */
async function offerDecisionButton(
  { page, world }: SurfaceContext,
  stage: Extract<OfferDecisionStage, 'offen' | 'angenommen'>,
  name: string,
): Promise<Locator> {
  const button = page.getByRole('main').getByRole('button', { name, exact: true });
  if (/\/angebote\/[0-9a-f-]{36}$/.test(page.url()) && (await button.count()) === 1) return button;
  const offerId = await surfaceFixture(world, `commercial.offer-decision-${stage}`, () =>
    seedDecidedOffer(
      world,
      stage === 'offen' ? 'Heizungsmodernisierung Zedernhof' : 'Heizungsmodernisierung Mispelweg',
      stage,
    ),
  );
  await page.goto(`/angebote/${offerId}`);
  return button;
}

/** The Angebote openers; their acceptance captures run with the inventory group. */
export const COMMERCIAL_OPENERS = {
  'commercial.offer': {
    trigger: async ({ page }) =>
      page.getByRole('main').getByRole('button', { name: 'Angebot anlegen', exact: true }),
    layer: (page) => page.getByRole('dialog', { name: 'Angebot anlegen', exact: true }),
  },
  'commercial.offer-header': {
    trigger: async ({ page }) =>
      page.getByRole('main').getByRole('button', { name: 'Bearbeiten', exact: true }),
    layer: (page) => page.getByRole('dialog', { name: 'Angebotskopf bearbeiten', exact: true }),
  },
  'commercial.offer-preview': {
    trigger: async ({ page }) =>
      page.getByRole('main').getByRole('button', { name: 'Vorschau', exact: true }),
    layer: (page) => page.getByRole('dialog', { name: /^Vorschau ANG-/ }),
  },
  'commercial.offer-revision': {
    // The audit world's offer is a draft: „Bearbeiten“ of a sent one starts its next revision.
    trigger: async ({ page, world }) => {
      const offerId = await surfaceFixture(world, 'commercial.offer-revision', () =>
        seedRevisedOffer(world, 'Layout Angebot gesendet', 'sent'),
      );
      await page.goto(`/angebote/${offerId}`);
      return page.getByRole('main').getByRole('button', { name: 'Bearbeiten', exact: true });
    },
    layer: (page) => page.getByRole('alertdialog', { name: /^Revision \d+ bearbeiten\?$/ }),
  },
  'commercial.offer-acceptance': {
    trigger: (context) => offerDecisionButton(context, 'offen', 'Annahme erfassen'),
    layer: (page) => page.getByRole('dialog', { name: /^Annahme von Revision \d+ erfassen$/ }),
  },
  'commercial.offer-rejection': {
    trigger: (context) => offerDecisionButton(context, 'offen', 'Ablehnung erfassen'),
    layer: (page) => page.getByRole('dialog', { name: 'Ablehnung erfassen', exact: true }),
  },
  'commercial.offer-withdrawal': {
    trigger: (context) => offerDecisionButton(context, 'offen', 'Zurückziehen'),
    layer: (page) => page.getByRole('dialog', { name: 'Angebot zurückziehen', exact: true }),
  },
  'commercial.offer-acceptance-withdrawal': {
    trigger: (context) => offerDecisionButton(context, 'angenommen', 'Annahme zurücknehmen'),
    layer: (page) => page.getByRole('dialog', { name: 'Annahme zurücknehmen', exact: true }),
  },
  'commercial.offer-conversion': {
    trigger: (context) => offerDecisionButton(context, 'angenommen', 'In Arbeit übernehmen'),
    layer: (page) => page.getByRole('dialog', { name: 'In Arbeit übernehmen', exact: true }),
  },
  'commercial.invoice': {
    trigger: async ({ page }) =>
      page.getByRole('main').getByRole('button', { name: 'Rechnung erstellen', exact: true }),
    layer: (page) => page.getByRole('dialog', { name: 'Rechnung erstellen', exact: true }),
  },
  'commercial.invoice-delete': {
    trigger: async ({ page }) =>
      page.getByRole('main').getByRole('button', { name: 'Entwurf löschen', exact: true }),
    layer: (page) => page.getByRole('alertdialog', { name: /^Entwurf für „.+“ löschen\?$/ }),
  },
  'commercial.invoice-send': {
    trigger: async (context) => invoiceDeliveryButton(context, 'Per E-Mail senden'),
    layer: (page) => page.getByRole('dialog', { name: 'Rechnung per E-Mail senden', exact: true }),
  },
  // The newest revision's sends; the audit waits for their read to settle.
  'commercial.offer-delivery': { trigger: offerDeliveryButton, layer: offerDeliveryLayer },
  // The email step: recipient, subject and text before „Senden“.
  'commercial.offer-delivery-email': {
    trigger: offerDeliveryButton,
    layer: offerDeliveryLayer,
    prepareLayer: async (layer) => {
      await layer.getByRole('button', { name: 'Per E-Mail senden', exact: true }).click();
      await expect(layer.getByRole('textbox', { name: 'Empfänger' })).toBeVisible();
    },
  },
  'commercial.invoice-sent-manually': {
    trigger: async (context) => invoiceDeliveryButton(context, 'Als manuell versendet markieren'),
    layer: (page) => page.getByRole('dialog', { name: 'Als manuell versendet markieren', exact: true }),
  },
  'commercial.invoice-cancel': {
    trigger: async ({ page, world }) => issuedInvoiceButton(page, world, 'Stornieren'),
    layer: (page) => page.getByRole('dialog', { name: /^Rechnung .+ stornieren\?$/ }),
  },
  'commercial.invoice-correct': {
    trigger: async ({ page, world }) => issuedInvoiceButton(page, world, 'Korrigieren'),
    layer: (page) => page.getByRole('dialog', { name: /^Rechnung .+ korrigieren\?$/ }),
  },
  'commercial.invoice-issue': {
    trigger: async ({ page }) =>
      page.getByRole('main').getByRole('button', { name: 'Ausstellen', exact: true }),
    layer: (page) => page.getByRole('alertdialog', { name: 'Rechnung ausstellen?', exact: true }),
  },
  'commercial.leistung': {
    trigger: async ({ page }) => createLeistungButton(page),
    layer: (page) => leistungDialogLayer(page, 'create'),
  },
  'commercial.leistung-prices': {
    trigger: async (context) => {
      await prepareLeistung(context);
      return openMenuItem(seededRowActionsButton(context), leistungRowActionItem(context.page, 'prices'));
    },
    layer: leistungPriceDialogLayer,
    returnFocus: seededRowActionsButton,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
