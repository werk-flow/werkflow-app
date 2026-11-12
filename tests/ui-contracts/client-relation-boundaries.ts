// Isolated server state of a customer's contacts and work sites. Archiving a
// row waits in the write gate; an accepted change lands in the state the next
// route read returns.
import type { ClientSiteRole } from '@/lib/clients/site-roles';
import type { ClientContact, ClientSite } from '@/lib/clients/types';
import { holdWrite } from './held-write-boundary';

const clientId = 'contract-client';
const createdAt = '2026-10-01T08:00:00.000Z';

declare global {
  interface Window {
    uiContractClientRelations: { contacts: ClientContact[]; sites: ClientSite[] };
    /** The roles the next route read returns; null when that read fails. */
    uiContractClientSiteRoles: ClientSiteRole[] | null;
  }
}

window.uiContractClientRelations = {
  contacts: [
    {
      id: 'contract-contact',
      organizationId: 'contract-organization',
      clientId,
      name: 'Petra Pohl',
      role: 'Hausverwaltung',
      // Stored before the save checked the format: text, not one address.
      email: 'petra.pohl(at)example.de',
      phone: null,
      notes: null,
      siteId: null,
      siteRole: null,
      isPrimary: true,
      isActive: true,
      createdBy: null,
      createdAt,
      updatedAt: createdAt,
    },
  ],
  sites: [
    {
      id: 'contract-site',
      organizationId: 'contract-organization',
      clientId,
      name: 'Heizungskeller Nordflügel',
      street: 'Lindenstraße 4',
      postalCode: '10115',
      city: 'Berlin',
      sourceNumber: null,
      accessNotes: null,
      notes: null,
      primaryContactId: null,
      isPrimary: true,
      isActive: true,
      createdBy: null,
      createdAt,
      updatedAt: createdAt,
    },
  ],
};

export const clientRelationContractId = clientId;

const contractSite = {
  siteId: 'contract-site',
  siteName: 'Heizungskeller Nordflügel',
  siteAddress: 'Lindenstraße 4, 10115 Berlin',
  siteSourceNumber: null,
  siteIsActive: true,
  siteClientId: clientId,
  siteClientName: 'WEG Lindenstraße 4',
  holderArchived: false,
} as const;

/**
 * The roles of the contract's work site: a current Hausverwaltung; an owner
 * handover already recorded for a day far ahead, so the current owner ends
 * and the coming one has no end; and a Rechnungsempfänger only to come.
 */
window.uiContractClientSiteRoles = [
  {
    ...contractSite,
    id: 'contract-role',
    holderClientId: 'contract-manager',
    holderName: 'Hausverwaltung Lindenhof GmbH',
    role: 'hausverwaltung',
    startsOn: '2020-01-01',
    endsOn: null,
  },
  {
    ...contractSite,
    id: 'contract-owner-now',
    holderClientId: 'contract-owner-now',
    holderName: 'Erika Musterfrau',
    role: 'eigentuemer',
    startsOn: '2020-01-01',
    endsOn: '2098-12-31',
  },
  {
    ...contractSite,
    id: 'contract-owner-next',
    holderClientId: 'contract-owner-next',
    holderName: 'Max Mustermann',
    role: 'eigentuemer',
    startsOn: '2099-01-01',
    endsOn: null,
  },
  {
    ...contractSite,
    id: 'contract-payer-next',
    holderClientId: 'contract-manager',
    holderName: 'Hausverwaltung Lindenhof GmbH',
    role: 'rechnungsempfaenger',
    startsOn: '2099-01-01',
    endsOn: null,
  },
];

/** Ending a role waits in the write gate; an accepted end changes no role, the spec sets what the next read returns. */
export async function endClientSiteRoleContract(input: {
  roleId: string;
  endsOn: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const refusal = await holdWrite('end-client-site-role', input);
  return refusal ? { success: false, error: refusal } : { success: true };
}

export async function updateClientContactContract(
  contactId: string,
  input: { isActive?: boolean },
): Promise<{ success: true; contact: ClientContact } | { success: false; error: string }> {
  const refusal = await holdWrite('update-client-contact', { contactId, input });
  if (refusal) return { success: false, error: refusal };
  const state = window.uiContractClientRelations;
  const stored = state.contacts.find((contact) => contact.id === contactId);
  if (!stored) return { success: false, error: 'contact_not_found' };
  const contact = { ...stored, ...input };
  state.contacts = state.contacts.map((entry) => (entry.id === contactId ? contact : entry));
  return { success: true, contact };
}

export async function updateClientSiteContract(
  siteId: string,
  input: { isActive?: boolean },
): Promise<{ success: true; site: ClientSite } | { success: false; error: string }> {
  const refusal = await holdWrite('update-client-site', { siteId, input });
  if (refusal) return { success: false, error: refusal };
  const state = window.uiContractClientRelations;
  const stored = state.sites.find((site) => site.id === siteId);
  if (!stored) return { success: false, error: 'site_not_found' };
  const site = { ...stored, ...input };
  state.sites = state.sites.map((entry) => (entry.id === siteId ? site : entry));
  return { success: true, site };
}
