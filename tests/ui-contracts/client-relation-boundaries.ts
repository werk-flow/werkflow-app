// Isolated server state of a customer's contacts and work sites. Archiving a
// row waits in the write gate; an accepted change lands in the state the next
// route read returns.
import type { ClientContact, ClientSite } from '@/lib/clients/types';
import { holdWrite } from './held-write-boundary';

const clientId = 'contract-client';
const createdAt = '2026-10-01T08:00:00.000Z';

declare global {
  interface Window {
    uiContractClientRelations: { contacts: ClientContact[]; sites: ClientSite[] };
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
      email: null,
      phone: null,
      notes: null,
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
