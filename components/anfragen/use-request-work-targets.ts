'use client';

import { useEffect, useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { RequestWorkTarget } from '@/lib/requests/types';

const SEARCH_DEBOUNCE_MS = 150;

/**
 * The open work of the request's customer the attach dialog offers, at the
 * request's site first, narrowed by the typed search. The read runs over the
 * background-read route while the dialog is open, so it never queues behind
 * a save.
 */
export function useRequestWorkTargets(requestId: string): {
  search: string;
  setSearch: (search: string) => void;
  /** The search the shown targets answer. */
  searchedQuery: string;
  targets: RequestWorkTarget[] | undefined;
  /** More open work matches than the dialog shows; a search narrows it. */
  hasMore: boolean;
  loading: boolean;
  failure: ReadFailure | null;
} {
  const { activeOrgId } = useOrganization();
  const [search, setSearch] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearchedQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const read = useClientRead({
    read: (signal) =>
      readInBackground(
        'request-work-targets',
        { organizationId: activeOrgId ?? '', requestId, query: searchedQuery },
        signal,
      ),
    deps: [activeOrgId, requestId, searchedQuery],
    enabled: Boolean(activeOrgId),
    failureMessage: 'Die offene Arbeit des Kunden konnte nicht geladen werden.',
    keepPreviousData: true,
  });
  return {
    search,
    setSearch,
    searchedQuery,
    targets: read.data?.targets,
    hasMore: read.data?.hasMore ?? false,
    loading: read.loading,
    failure: read.failure,
  };
}
