import type { Locator, Page } from '@playwright/test';

import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '../../../lib/invoices/types';

// Copy and structure of an invoice page (components/rechnungen/,
// app/(app)/rechnungen/[invoiceId]/page.tsx) for the invoice audits.

const CANCEL_MODES = {
  cancel: { action: 'Stornieren', verb: 'stornieren', submit: 'Stornorechnung ausstellen' },
  correct: { action: 'Korrigieren', verb: 'korrigieren', submit: 'Stornieren und Entwurf anlegen' },
} as const;

type CancelMode = keyof typeof CANCEL_MODES;

const DRAFT_TITLE = 'Rechnungsentwurf';
const REASON_LABEL = 'Grund der Stornierung';
const CHAIN_TITLE = 'Storno und Korrektur';

/** The page header, which carries the invoice's title, status and actions. */
function invoiceHeader(page: Page): Locator {
  return page.locator('[data-page-header]').filter({ visible: true });
}

/** The title of an issued invoice („Rechnung RE-…“) or, without a number, of a draft. */
export function invoiceTitle(invoiceNumber: string | null): string {
  return invoiceNumber === null ? DRAFT_TITLE : `Rechnung ${invoiceNumber}`;
}

/** The page's heading, named by its title. */
export function invoicePageHeading(page: Page, title: string): Locator {
  return invoiceHeader(page).getByRole('heading', { level: 1, name: title, exact: true });
}

/** The page header's status badge. */
export function invoiceHeaderStatus(page: Page, status: InvoiceStatus): Locator {
  return invoiceHeader(page).getByText(INVOICE_STATUS_LABELS[status], { exact: true });
}

/** „Stornieren“ or „Korrigieren“ in the page header. */
export function invoiceCancelAction(page: Page, mode: CancelMode): Locator {
  return invoiceHeader(page).getByRole('button', { name: CANCEL_MODES[mode].action, exact: true });
}

/** Opens „Stornieren“ or „Korrigieren“, gives the reason and confirms. */
export async function cancelInvoiceViaDialog(
  page: Page,
  options: { invoiceNumber: string; mode: CancelMode; reason: string },
): Promise<void> {
  const copy = CANCEL_MODES[options.mode];
  await invoiceCancelAction(page, options.mode).click();
  const dialog = page.getByRole('dialog', {
    name: `${invoiceTitle(options.invoiceNumber)} ${copy.verb}?`,
    exact: true,
  });
  await dialog.getByLabel(REASON_LABEL).fill(options.reason);
  await dialog.getByRole('button', { name: copy.submit, exact: true }).click();
}

/** The section „Storno und Korrektur“ that lists the chain. */
export function invoiceChain(page: Page): Locator {
  return page.getByRole('main').getByRole('region', { name: CHAIN_TITLE, exact: true });
}

/** The chain's entry of the page's own invoice, which is no link. */
export function invoiceChainCurrent(chain: Locator): Locator {
  return chain.locator('[aria-current="page"]');
}

/** A chain link by its label: „Rechnung …“, „Stornorechnung …“, „Korrektur ohne Nummer“. */
export function invoiceChainLink(chain: Locator, label: string | RegExp): Locator {
  return chain.getByRole('link', { name: label, exact: typeof label === 'string' });
}

/** The label of a Stornorechnung's chain link, any number. */
export const STORNO_CHAIN_LABEL = /^Stornorechnung \S+$/;

/** The label of a correction draft's chain link. */
export const CORRECTION_DRAFT_CHAIN_LABEL = 'Korrektur ohne Nummer';
