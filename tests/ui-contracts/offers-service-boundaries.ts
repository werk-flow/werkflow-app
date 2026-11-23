import { holdWrite } from './held-write-boundary';

// The offer actions and router in the contract fixture: every create the
// dialog sends is counted, so a contract can prove a press sent none; a
// header save waits until the spec answers it.
declare global {
  interface Window {
    uiContractOfferCreates: number;
  }
}

window.uiContractOfferCreates = 0;

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
  return refusal
    ? { success: false, error: refusal }
    : { success: true, offerId: 'contract-offer', version: 2, updatedAt: '2026-11-23T08:00:00.000000+00:00' };
}

export function useRouter(): { push: () => void } {
  return { push: () => undefined };
}
