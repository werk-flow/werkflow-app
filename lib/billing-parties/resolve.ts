import type { BillingParty, BillingRecipient, WorkBillingPartyVersion } from './types';

/** A version with both parties named. */
export type ResolvedBillingVersion = Omit<WorkBillingPartyVersion, 'auftraggeber' | 'recipient'> & {
  auftraggeber: BillingParty;
  recipient: BillingRecipient;
};

/**
 * The versions with both parties named: the job's customer stands in where
 * the job's own read left a party out because it repeats that customer. A
 * version without a customer to stand in is left out.
 */
export function resolveBillingVersions(
  versions: readonly WorkBillingPartyVersion[],
  workClient: BillingRecipient | null,
): ResolvedBillingVersion[] {
  return versions.flatMap((version) => {
    const auftraggeber = version.auftraggeber ?? workClient;
    const recipient = version.recipient ?? workClient;
    return auftraggeber && recipient ? [{ ...version, auftraggeber, recipient }] : [];
  });
}
