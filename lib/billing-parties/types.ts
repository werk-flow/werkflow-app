import { z } from '@/lib/zod';

/**
 * Who commissioned a request, job, project or Servicefall (the Auftraggeber)
 * and who receives its invoice (the Rechnungsempfänger), with the
 * recipient's name and address as they were when it was set. Offers read
 * this copy (werk-flow/werkflow-planning#16). Office-only.
 */
export const BILLING_WORK_KINDS = ['request', 'job', 'project', 'service_case'] as const;
export type BillingWorkKind = (typeof BILLING_WORK_KINDS)[number];

const BILLING_PARTY_SOURCES = ['objekt', 'auftraggeber', 'projekt', 'anfrage', 'buero'] as const;
type BillingPartySource = (typeof BILLING_PARTY_SOURCES)[number];

/** Why this recipient: shown under it on the work. */
export const BILLING_PARTY_SOURCE_LABELS: Readonly<Record<BillingPartySource, string>> = {
  objekt: 'Rechnungsempfänger des Einsatzorts',
  auftraggeber: 'Wie Auftraggeber',
  projekt: 'Aus dem Projekt übernommen',
  anfrage: 'Aus der Anfrage übernommen',
  buero: 'Vom Büro gewählt',
};

const versionSchema = z.object({
  id: z.string(),
  version: z.number(),
  source: z.enum(BILLING_PARTY_SOURCES),
  clientId: z.string(),
  clientName: z.string(),
  recipientClientId: z.string(),
  recipientName: z.string(),
  recipientAddress: z.string().nullable(),
  setAt: z.string(),
  setByName: z.string().nullable(),
});

/** The read of get_work_billing_parties: every version, newest first. */
export const workBillingPartiesSchema = z.object({
  hasClient: z.boolean(),
  versions: z.array(versionSchema),
  site: z
    .object({
      id: z.string(),
      name: z.string(),
      street: z.string().nullable(),
      postalCode: z.string().nullable(),
      city: z.string().nullable(),
    })
    .nullable(),
  accessContacts: z.array(z.object({ id: z.string(), name: z.string(), phone: z.string().nullable() })),
});

export type WorkBillingParties = z.infer<typeof workBillingPartiesSchema>;
export type WorkBillingPartyVersion = WorkBillingParties['versions'][number];
