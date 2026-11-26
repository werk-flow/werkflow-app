import { freezeLiveUpdates } from '../../golden/support/live';
import { expect, test } from '../support/fixtures';
import { readStoredInvoiceChain, seedInvoiceChain } from '../../golden/support/db/invoices';
import {
  cancelInvoiceViaDialog,
  CORRECTION_DRAFT_CHAIN_LABEL,
  invoiceCancelAction,
  invoiceChain,
  invoiceChainCurrent,
  invoiceChainLink,
  invoiceHeaderStatus,
  invoicePageHeading,
  invoiceTitle,
  STORNO_CHAIN_LABEL,
} from '../support/invoice-steps';

// „Korrigieren“ on an issued invoice, then Back, with Realtime frozen: the
// page Back restores must come from the cancel's own response
// (`cancelInvoice` revalidates the source route), not from a live update
// that arrives later (docs/technical/realtime-and-caching.md). The rules
// themselves are proven below the browser (supabase/tests/invoice_cancel.sql,
// lib/invoices/cancel-boundaries.test.ts).

const INVOICE_PATH = /^\/rechnungen\/[0-9a-f-]{36}$/;

test.describe('E2c invoice cancel and correction audit @AUDIT-W3-E2C-INVOICE-CANCEL @AUDIT-W3', () => {
  test('Back from the correction draft shows the original Storniert with its chain, without Realtime', async ({
    adminPage,
    world,
  }) => {
    const original = await seedInvoiceChain({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      customerName: `Hausverwaltung Lindenhof GmbH Korrigieren ${world.runId}`,
      state: 'issued',
    });
    const originalTitle = invoiceTitle(original.originalNumber);

    await test.step('The issued invoice opens with „Korrigieren“ while live updates are frozen', async () => {
      // A session without Realtime: nothing but the cancel's own response can turn this page Storniert.
      await freezeLiveUpdates(adminPage);
      await adminPage.goto(`/rechnungen/${original.originalId}`);
      await expect(invoicePageHeading(adminPage, originalTitle)).toBeVisible();
      await expect(invoiceHeaderStatus(adminPage, 'ausgestellt')).toBeVisible();
      await expect(invoiceChain(adminPage)).toHaveCount(0);
    });

    const { stornoLabel, correctionId } =
      await test.step('„Korrigieren“ cancels it and opens the correction draft', async () => {
        await cancelInvoiceViaDialog(adminPage, {
          invoiceNumber: original.originalNumber,
          mode: 'correct',
          reason: 'Falsche Menge abgerechnet',
        });
        await adminPage.waitForURL(
          (url) => INVOICE_PATH.test(url.pathname) && !url.pathname.endsWith(original.originalId),
        );
        await expect(invoicePageHeading(adminPage, invoiceTitle(null))).toBeVisible();
        const chain = invoiceChain(adminPage);
        await expect(invoiceChainLink(chain, originalTitle)).toBeVisible();
        const stornoLink = invoiceChainLink(chain, STORNO_CHAIN_LABEL);
        await expect(stornoLink).toBeVisible();
        return {
          stornoLabel: (await stornoLink.textContent()) ?? '',
          correctionId: new URL(adminPage.url()).pathname.split('/').at(-1),
        };
      });

    await test.step('Back shows the original Storniert, its chain linked and its actions gone', async () => {
      await adminPage.goBack();
      await adminPage.waitForURL((url) => url.pathname === `/rechnungen/${original.originalId}`);
      await expect(invoicePageHeading(adminPage, originalTitle)).toBeVisible();
      await expect(invoiceHeaderStatus(adminPage, 'storniert')).toBeVisible();
      await expect(invoiceCancelAction(adminPage, 'correct')).toHaveCount(0);
      await expect(invoiceCancelAction(adminPage, 'cancel')).toHaveCount(0);
      const chain = invoiceChain(adminPage);
      await expect(invoiceChainCurrent(chain)).toHaveText(originalTitle);
      await expect(invoiceChainLink(chain, stornoLabel)).toBeVisible();
      await expect(invoiceChainLink(chain, CORRECTION_DRAFT_CHAIN_LABEL)).toBeVisible();
    });

    await test.step('The database holds the original Storniert, its Stornorechnung and the opened draft', async () => {
      const stored = await readStoredInvoiceChain(world.orgId, original.originalId);
      expect(stored.status).toBe('storniert');
      expect(stored.storno?.status).toBe('ausgestellt');
      expect(stored.correction).toEqual({ id: correctionId, status: 'entwurf' });
    });
  });
});
