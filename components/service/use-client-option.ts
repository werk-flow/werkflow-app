'use client';

import { useOrganization } from '@/components/organization/organization-context';
import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { ServiceCaseClientOption } from '@/lib/service-cases/types';

/**
 * The sites, contacts and equipment of the one customer a service form has
 * selected. A form reads them over the background-read route when the
 * customer is chosen, so no page carries the sites and equipment of every
 * customer and the read never queues behind a save. `preloaded` is the
 * customer a detail page already holds.
 */
export function useClientOption(
  clientId: string,
  preloaded?: ServiceCaseClientOption | null,
): {
  client: ServiceCaseClientOption | null;
  loading: boolean;
  /** The failed read with its retry; the dependent select offers „Erneut laden“. */
  loadFailure: ReadFailure | null;
} {
  const { activeOrgId } = useOrganization();
  const isPreloaded = preloaded?.id === clientId;
  const option = useClientRead({
    read: (signal) =>
      readInBackground('service-client-option', { organizationId: activeOrgId ?? '', clientId }, signal),
    deps: [activeOrgId, clientId],
    enabled: clientId !== '' && !isPreloaded && Boolean(activeOrgId),
    failureMessage: 'Einsatzorte und Anlagen dieses Kunden konnten nicht geladen werden.',
  });
  return {
    client: (isPreloaded ? preloaded : option.data?.client) ?? null,
    loading: option.loading,
    loadFailure: option.failure,
  };
}
