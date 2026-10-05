'use client';

import { useCallback, useEffect, useState } from 'react';

import { getServiceClientOption } from '@/lib/service-cases/actions';
import type { ServiceCaseClientOption } from '@/lib/service-cases/types';

type Loaded = {
  clientId: string;
  client: ServiceCaseClientOption | null;
  failed: boolean;
};

/**
 * The sites, contacts and equipment of the one customer a service form has
 * selected. A form reads them when the customer is chosen, so no page carries
 * the sites and equipment of every customer. `preloaded` is the customer a
 * detail page already holds.
 */
export function useClientOption(
  clientId: string,
  preloaded?: ServiceCaseClientOption | null,
): {
  client: ServiceCaseClientOption | null;
  loading: boolean;
  /** Set when the read failed; opening the dependent select reads again through `retry`. */
  error: string | undefined;
  retry: () => void;
} {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const isPreloaded = preloaded?.id === clientId;
  const needsRead = clientId !== '' && !isPreloaded && loaded?.clientId !== clientId;

  useEffect(() => {
    if (!needsRead) return;
    let cancelled = false;
    void getServiceClientOption(clientId)
      .then((result) => {
        if (cancelled) return;
        setLoaded({
          clientId,
          client: result.success ? result.client : null,
          failed: !result.success,
        });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ clientId, client: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, needsRead]);

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
      ? 'Einsatzorte und Anlagen dieses Kunden konnten nicht geladen werden. Öffne die Auswahl erneut.'
      : undefined,
    retry,
  };
}
