/**
 * Who commissioned a request, job, project or Servicefall (the Auftraggeber)
 * and who receives its invoice (the Rechnungsempfänger), with the
 * recipient's name and address as they were when it was set. Offers read
 * this copy (werk-flow/werkflow-planning#16). Office-only. Types only, so a
 * client module that imports them carries no code.
 */
export const BILLING_WORK_KINDS = ['request', 'job', 'project', 'service_case'] as const;
export type BillingWorkKind = (typeof BILLING_WORK_KINDS)[number];

export const BILLING_PARTY_SOURCES = ['objekt', 'auftraggeber', 'projekt', 'anfrage', 'buero'] as const;
export type BillingPartySource = (typeof BILLING_PARTY_SOURCES)[number];

export type WorkBillingPartyVersion = {
  id: string;
  version: number;
  source: BillingPartySource;
  clientId: string;
  clientName: string;
  recipientClientId: string;
  recipientName: string;
  recipientAddress: string | null;
  setAt: string;
};

/** Every version of one work, newest first, with its Einsatzort and the Objekt's access contacts. */
export type WorkBillingParties = {
  hasClient: boolean;
  versions: WorkBillingPartyVersion[];
  site: {
    id: string;
    name: string;
    street: string | null;
    postalCode: string | null;
    city: string | null;
  } | null;
  accessContacts: { id: string; name: string; phone: string | null }[];
};
