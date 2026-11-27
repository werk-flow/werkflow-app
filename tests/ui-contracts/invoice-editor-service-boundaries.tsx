// Isolated stand-ins for what the invoice editor, the invoice settings form
// and „Versand“ reach on the server: the catalog read, the settings save and
// a retried send wait for the spec's answer (held-write-boundary.ts); issuing,
// sending, the router, realtime and links stay inert.
import type { InvoiceLineSourceRef } from '@/lib/invoices/line-sources';
import type { SaveInvoiceSettingsInput } from '@/lib/invoices/settings';
import { holdWrite, unexpectedWrite } from './held-write-boundary';

export async function readInvoiceLineSource(input: InvoiceLineSourceRef) {
  const refusal = await holdWrite('readInvoiceLineSource', input);
  if (refusal) return { success: false as const, error: refusal };
  return {
    success: true as const,
    line: {
      name: 'Monteurstunde',
      description: '',
      unit: 'hour' as const,
      unitPriceCents: 7200,
      priceQuantity: 1 as const,
      taxRateBasisPoints: 1900 as const,
      source: { kind: input.kind, id: input.id, number: 'L-7', name: 'Monteurstunde', archived: false },
    },
  };
}

export async function saveInvoiceSettings(input: SaveInvoiceSettingsInput) {
  const refusal = await holdWrite('saveInvoiceSettings', input);
  return refusal ? { success: false as const, error: refusal } : { success: true as const, version: 2 };
}

/**
 * A retry the spec accepts fails: the provider refuses the mail, and the
 * server's record holds an attempt without an answer, which a row that
 * predates it does not show.
 */
export async function retryInvoiceDelivery(input: { deliveryId: string; expectedAttempt: number }) {
  const refusal = await holdWrite('retryInvoiceDelivery', input);
  if (refusal) return { success: false as const, error: refusal };
  return {
    success: true as const,
    state: 'failed' as const,
    failureCode: 'email_provider_422',
    outcomeUnknown: true,
  };
}

export const issueInvoice = unexpectedWrite;
export const fileInvoiceOriginal = unexpectedWrite;
export const sendInvoiceEmail = unexpectedWrite;
export const markInvoiceSentManually = unexpectedWrite;

export function useRouter() {
  return { refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} };
}

export function useRealtimeRouterRefresh(): void {}

export default function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href}>{children}</a>;
}
