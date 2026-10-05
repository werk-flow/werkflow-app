import { unexpectedWrite } from './held-write-boundary';
import { updateClientContactContract, updateClientSiteContract } from './client-relation-boundaries';

export async function createClient(): Promise<never> {
  throw new Error('Unexpected customer mutation in read contract');
}
export async function updateClient(): Promise<never> {
  throw new Error('Unexpected customer mutation in read contract');
}
export async function deleteClient(): Promise<never> {
  throw new Error('Unexpected customer mutation in read contract');
}

// The customer's contact and work-site rows archive through these two writes.
export const updateClientContact = updateClientContactContract;
export const updateClientSite = updateClientSiteContract;
export const createClientContact = unexpectedWrite;
export const createClientSite = unexpectedWrite;
