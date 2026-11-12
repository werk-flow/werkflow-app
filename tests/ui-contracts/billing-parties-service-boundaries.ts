// The billing parties dialog's Server Action in the contract fixture: no
// contract saves through it; it only must not pull the server into the bundle.
export async function setWorkBillingParties(): Promise<{ success: true }> {
  return { success: true };
}
