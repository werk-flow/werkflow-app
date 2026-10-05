export type FailureMode = 'returned' | 'thrown' | 'none';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';
import { unexpectedWrite } from './held-write-boundary';
import {
  deleteEntryContract,
  reviewChangeRequestContract,
  reviewEntriesContract,
} from './time-approval-boundaries';
import { createJobMaterialLineContract, readMaterialPickerContract } from './material-boundaries';
import type { InventoryLocation, InventoryLocationType } from '@/lib/inventory/types';
// Keep framework redirect/error classification real; only navigation and
// external services are substituted by this fixture.
export { unstable_rethrow } from 'next/dist/client/components/unstable-rethrow.browser';
export type ServiceBoundaryState = {
  authFailure: FailureMode;
  paymentFailure: FailureMode;
  callbackFailure: boolean;
  navigation: string[];
  callbackCalls: number;
  createdLocations: string[];
};

declare global {
  interface Window {
    uiContractServices: ServiceBoundaryState;
  }
}

export function initializeServiceBoundaries(): void {
  const browserFetch = window.fetch.bind(window);
  window.uiContractServices = {
    authFailure: 'returned',
    paymentFailure: 'thrown',
    callbackFailure: false,
    navigation: [],
    callbackCalls: 0,
    createdLocations: [],
  };
  window.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      // The clock contract intercepts this GET at Playwright's network boundary.
      if (
        window.uiContractFixture === 'customer' &&
        typeof input === 'string' &&
        input.startsWith('/api/customer-page?') &&
        (init?.method ?? 'GET') === 'GET'
      ) {
        return browserFetch(input, init);
      }
      if (
        window.uiContractFixture === 'clock' &&
        typeof input === 'string' &&
        input.startsWith('/api/time-tracking-state?') &&
        (init?.method ?? 'GET') === 'GET'
      ) {
        return browserFetch(input, init);
      }
      if (input !== '/auth/callback') throw new Error('Unexpected request in isolated UI contracts.');
      window.uiContractServices.callbackCalls += 1;
      if (window.uiContractServices.callbackFailure)
        throw new Error('Simulated callback connection failure.');
      return new Response(null, { status: 200 });
    },
    {
      preconnect: () => {
        throw new Error('Network preconnect is forbidden in isolated UI contracts.');
      },
    },
  );
}

export async function createInventoryLocation(input: {
  name: string;
  description: string;
  locationType: InventoryLocationType;
}): Promise<{ success: true; location: InventoryLocation }> {
  window.uiContractServices.createdLocations.push(input.name);
  return {
    success: true,
    location: {
      id: 'contract-location',
      name: input.name,
      description: input.description,
      locationType: input.locationType,
      parentLocationId: null,
      sortOrder: 0,
      isActive: true,
    },
  };
}

export function createSupabaseBrowserClient() {
  return {
    auth: {
      signOut: async () => {
        const failure = window.uiContractServices.authFailure;
        if (failure === 'thrown') throw new Error('Simulated auth connection failure.');
        return {
          error: failure === 'returned' ? new Error('Simulated auth rejection.') : null,
        };
      },
    },
  };
}

export async function simulatePayment(): Promise<{
  success: boolean;
  error?: string;
}> {
  const failure = window.uiContractServices.paymentFailure;
  if (failure === 'thrown') throw new Error('Simulated payment connection failure.');
  return failure === 'returned' ? { success: false, error: 'not_authenticated' } : { success: true };
}

export async function clearEmailChangeChallengeBeforeSignOut(): Promise<{
  success: true;
}> {
  return { success: true };
}
export async function clockOutBeforeSignOut(): Promise<void> {
  /* Deterministic successful cleanup boundary. */
}

// `@/lib/time-tracking/actions`: the approval cards and the entry details dialog.
export const reviewEntries = reviewEntriesContract;
export const reviewChangeRequest = reviewChangeRequestContract;
export const deleteEntry = deleteEntryContract;
export const deleteEntriesBatch = unexpectedWrite;
export const updateEntry = unexpectedWrite;
export const addManualEntry = unexpectedWrite;

// `@/lib/inventory/actions`: the job material section plans one line.
export const createJobMaterialLine = createJobMaterialLineContract;
export const getInventoryPickerOptionsForJob = readMaterialPickerContract;
export const getInventoryPickerPage = readMaterialPickerContract;
export const createProjectMaterialLine = unexpectedWrite;
export const updateJobMaterialLine = unexpectedWrite;
export const deleteJobMaterialLine = unexpectedWrite;
export const takeJobMaterial = unexpectedWrite;
export const takeProjectMaterial = unexpectedWrite;
export const returnJobMaterial = unexpectedWrite;
export function useRouter(): {
  replace: (path: string) => void;
  refresh: () => void;
} {
  return {
    replace: (path) => window.uiContractServices.navigation.push(path),
    refresh: () => {
      window.uiContractServices.navigation.push('refresh');
      window.dispatchEvent(new Event(ROUTE_REFRESH_EVENT));
    },
  };
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}
