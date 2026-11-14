// The billing parties dialog's Server Action in the contract fixture: a save
// from version 1 finds that another save landed first, as
// set_work_billing_parties refuses it; any other save succeeds. Every save the
// dialog sends is counted, so a contract can prove a press sent none.
declare global {
  interface Window {
    uiContractBillingSaves: number;
  }
}

window.uiContractBillingSaves = 0;

export async function setWorkBillingParties(input: {
  expectedVersion: number;
}): Promise<{ success: true } | { success: false; error: string }> {
  window.uiContractBillingSaves += 1;
  return input.expectedVersion === 1 ? { success: false, error: 'parties_changed' } : { success: true };
}
