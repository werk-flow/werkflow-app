// The billing parties dialog's Server Action in the contract fixture: a save
// from version 1 finds that another save landed first, as
// set_work_billing_parties refuses it; any other save succeeds.
export async function setWorkBillingParties(input: {
  expectedVersion: number;
}): Promise<{ success: true } | { success: false; error: string }> {
  return input.expectedVersion === 1 ? { success: false, error: 'parties_changed' } : { success: true };
}
