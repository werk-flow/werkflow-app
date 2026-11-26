import type { OfferArticleLine } from '@/lib/invoices/line-sources';
import { holdWrite, unexpectedWrite } from './held-write-boundary';

// The offer actions and router in the contract fixture: every create the
// dialog sends is counted, so a contract can prove a press sent none; a
// header save waits until the spec answers it, and `answer_lost` throws as a
// save whose answer never arrived.
declare global {
  interface Window {
    uiContractOfferCreates: number;
    /** While true, the article picker's price read waits until the spec calls `uiContractArticleRead`. */
    uiContractHoldArticleRead: boolean;
    uiContractArticleRead: (() => void) | null;
  }
}

window.uiContractOfferCreates = 0;
window.uiContractHoldArticleRead = false;
window.uiContractArticleRead = null;

export async function createOffer(): Promise<{ success: false; error: string }> {
  window.uiContractOfferCreates += 1;
  return { success: false, error: 'save_failed' };
}

export async function updateOffer(
  input: unknown,
): Promise<
  { success: true; offerId: string; version: number; updatedAt: string } | { success: false; error: string }
> {
  const refusal = await holdWrite('update-offer', input);
  if (refusal === 'answer_lost') throw new Error('The answer of the save was lost.');
  return refusal
    ? { success: false, error: refusal }
    : { success: true, offerId: 'contract-offer', version: 2, updatedAt: '2026-11-23T08:00:00.000000+00:00' };
}

// The content version each attempt key was saved as: a repeat answers the first save's.
const contentVersions = new Map<string, number>();

function attemptKeyOf(input: unknown): string {
  return typeof input === 'object' &&
    input !== null &&
    'attemptKey' in input &&
    typeof input.attemptKey === 'string'
    ? input.attemptKey
    : '';
}

/**
 * A content save the spec answers. An accepted save takes the next version, the
 * first 2; `answer_lost` saves and throws, as a save whose answer never
 * arrived; a repeat under the same attempt key answers its first version, as
 * the database replays it.
 */
export async function saveOfferContent(
  input: unknown,
): Promise<
  | { success: true; offerId: string; contentVersion: number; updatedAt: string }
  | { success: false; error: string }
> {
  const refusal = await holdWrite('save-offer-content', input);
  if (refusal && refusal !== 'answer_lost') return { success: false, error: refusal };
  const key = attemptKeyOf(input);
  const contentVersion = contentVersions.get(key) ?? contentVersions.size + 2;
  contentVersions.set(key, contentVersion);
  if (refusal === 'answer_lost') throw new Error('The answer of the save was lost.');
  return {
    success: true,
    offerId: 'contract-offer',
    contentVersion,
    updatedAt: '2026-11-26T08:00:00.000000+00:00',
  };
}

/**
 * The article picker's price read: one Position from an article whose stored
 * unit is outside the list, so a contract can show the unit question.
 */
export async function readOfferArticleLine(): Promise<{ success: true; line: OfferArticleLine }> {
  if (window.uiContractHoldArticleRead) {
    await new Promise<void>((resolve) => {
      window.uiContractArticleRead = resolve;
    });
  }
  return {
    success: true,
    line: {
      name: 'Kupferbogen 15 mm',
      description: '',
      unit: null,
      unitPriceCents: 495,
      priceQuantity: 1,
      taxRateBasisPoints: 1900,
      source: {
        kind: 'article',
        id: 'contract-article',
        number: 'KB-15',
        name: 'Kupferbogen 15 mm',
        archived: false,
      },
    },
  };
}

/** The invoice editor's catalog read, which the offer editor imports with the source note and never calls. */
export const readInvoiceLineSource = unexpectedWrite;

export function useRouter(): { push: () => void } {
  return { push: () => undefined };
}
