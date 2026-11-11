import type { CreateClientInput } from '@/lib/clients/actions';
import type { CreateClientResult } from '@/lib/jobs/types';
import { holdWrite, unexpectedWrite } from './held-write-boundary';
import {
  endClientSiteRoleContract,
  updateClientContactContract,
  updateClientSiteContract,
} from './client-relation-boundaries';

/** The existing customer the create contract's refusal `possible_duplicates` names. */
export const CONTRACT_DUPLICATE = {
  clientId: '10000000-0000-4000-8000-000000000021',
  clientName: 'Erika Musterfrau',
} as const;

// The create dialog's save waits at the write gate. The spec accepts it, or
// refuses it with a code; `possible_duplicates` answers with one match.
export async function createClient(
  input: CreateClientInput,
  createDespiteMatches?: boolean,
): Promise<CreateClientResult> {
  const refusal = await holdWrite(
    createDespiteMatches ? 'createClient:despite-matches' : 'createClient',
    input,
  );
  if (refusal === 'possible_duplicates') {
    return {
      success: false,
      error: refusal,
      matches: [{ ...CONTRACT_DUPLICATE, matchedOn: ['phone', 'name'] }],
      moreMatches: false,
    };
  }
  if (refusal !== null) return { success: false, error: refusal };
  return {
    success: true,
    client: {
      id: '10000000-0000-4000-8000-000000000022',
      organizationId: '10000000-0000-4000-8000-000000000001',
      name: input.name,
      clientType: input.clientType,
      customerNumber: null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      createdAt: '',
      updatedAt: '',
    },
  };
}

/** The create dialog refreshes the route only inside a select; the contract mounts it on its own. */
export function useRouter(): { refresh: () => void } {
  return { refresh: () => undefined };
}
export async function updateClient(): Promise<never> {
  throw new Error('Unexpected customer mutation in read contract');
}
export async function deleteClient(): Promise<never> {
  throw new Error('Unexpected customer mutation in read contract');
}
export async function archiveClient(): Promise<never> {
  throw new Error('Unexpected customer mutation in read contract');
}
export async function restoreClient(): Promise<never> {
  throw new Error('Unexpected customer mutation in read contract');
}

// The customer's contact and work-site rows archive through these two writes.
export const updateClientContact = updateClientContactContract;
export const updateClientSite = updateClientSiteContract;
export const createClientContact = unexpectedWrite;
export const createClientSite = unexpectedWrite;

// The Einsatzort role editor ends a role through the write gate and records none.
export const assignClientSiteRole = unexpectedWrite;
export const endClientSiteRole = endClientSiteRoleContract;
