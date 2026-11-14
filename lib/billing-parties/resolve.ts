import type {
  BillingParty,
  BillingRecipient,
  BillingWorkKind,
  WorkBillingParties,
  WorkBillingPartyVersion,
} from './types';

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

/** The customers of the job reads a section has seen, by read. */
export type StandInsByRead = {
  remember: (parties: object, client: BillingRecipient | null) => void;
  clientFor: (parties: object) => BillingRecipient | null;
  /** Whether the parties came with the page's job read, which leaves the site out. */
  fromPage: (parties: object) => boolean;
};

/**
 * The job's customer as each job read returned it beside its parties. A
 * read's versions are filled from the customer of the same read, never from
 * a later one, so a customer change does not rewrite an earlier pair while
 * the section's own read is pending or failed.
 */
export function standInsByRead(): StandInsByRead {
  const clients = new WeakMap<object, BillingRecipient | null>();
  return {
    remember(parties: object, client: BillingRecipient | null): void {
      if (!clients.has(parties)) clients.set(parties, client);
    },
    clientFor(parties: object): BillingRecipient | null {
      return clients.get(parties) ?? null;
    },
    fromPage(parties: object): boolean {
      return clients.has(parties);
    },
  };
}

/**
 * Which party names the card links to their customer: a party that is the
 * work's own customer is linked by the page already, and a recipient that is
 * the Auftraggeber is linked once, on the Auftraggeber.
 */
export function partyLinks(
  version: ResolvedBillingVersion,
  workClientId: string | null,
): { auftraggeber: boolean; recipient: boolean } {
  return {
    auftraggeber: version.auftraggeber.id !== workClientId,
    recipient: version.recipient.id !== workClientId && version.recipient.id !== version.auftraggeber.id,
  };
}

/**
 * The Einsatzort the card shows: the page's own site stands in only for a
 * job read the page handed in, which leaves the site out; any read of the
 * section's own is authoritative, a removed site (null) included.
 */
export function shownBillingSite(
  parties: WorkBillingParties,
  fromPageRead: boolean,
  pageSite: WorkBillingParties['site'] | undefined,
): WorkBillingParties['site'] {
  return fromPageRead && pageSite !== undefined ? pageSite : parties.site;
}

/** The identity of one work's live billing view: another organization, kind or work starts it anew. */
export function billingPartiesScope(
  organizationId: string | null,
  kind: BillingWorkKind,
  id: string,
): string {
  return `${organizationId ?? ''}:${kind}:${id}`;
}
