'use client';

import { useCallback, useEffect, useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { readInBackground } from '@/lib/data/background-read-client';
import type { ServiceCaseClientOption } from '@/lib/service-cases/types';

type Loaded = {
  clientId: string;
  client: ServiceCaseClientOption | null;
  failed: boolean;
};

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
  /** Set when the read failed; the dependent select offers „Erneut laden“ through `retry`. */
  error: string | undefined;
  retry: () => void;
} {
  const { activeOrgId } = useOrganization();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const isPreloaded = preloaded?.id === clientId;
  const needsRead = clientId !== '' && !isPreloaded && loaded?.clientId !== clientId;

  useEffect(() => {
    if (!needsRead || !activeOrgId) return;
    const controller = new AbortController();
    void readInBackground(
      'service-client-option',
      { organizationId: activeOrgId, clientId },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setLoaded({ clientId, client: result.success ? result.client : null, failed: !result.success });
    });
    return () => controller.abort();
  }, [activeOrgId, clientId, needsRead]);

  const retry = useCallback(() => setLoaded(null), []);
  const current = isPreloaded
    ? { client: preloaded, failed: false }
    : loaded?.clientId === clientId
      ? loaded
      : null;
  return {
    client: current?.client ?? null,
    loading: needsRead,
    error: current?.failed
      ? 'Einsatzorte und Anlagen dieses Kunden konnten nicht geladen werden.'
      : undefined,
    retry,
  };
}
