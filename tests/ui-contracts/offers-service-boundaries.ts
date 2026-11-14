// The offer actions and router in the contract fixture: every create the
// dialog sends is counted, so a contract can prove a press sent none.
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

export async function updateOffer(): Promise<{ success: false; error: string }> {
  return { success: false, error: 'save_failed' };
}

export function useRouter(): { push: () => void } {
  return { push: () => undefined };
}
