'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import { readInBackground } from '@/lib/data/background-read-client';
import type { JobEntityOption, JobOptionRequest } from '@/lib/jobs/option-types';

type Request = Pick<JobOptionRequest, 'kind' | 'purpose' | 'clientId' | 'projectId' | 'siteId'>;
export type JobEntityOptionsState = {
  options: JobEntityOption[];
  onSearchChange: (query: string) => void;
  loading: boolean;
  loadError: string | undefined;
  /** Reads the failed page again with the same text. */
  onRetryLoad: (() => void) | undefined;
  onLoadMore: (() => void) | undefined;
};

const LOAD_ERROR = 'Die Auswahl konnte nicht geladen werden.';
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 150;
const NO_OPTIONS: JobEntityOption[] = [];

type Page = { scope: string; query: string; offset: number; options: JobEntityOption[]; hasMore: boolean };

/**
 * One bounded server search per entity picker, never a whole-company list.
 * The read runs over the background-read route, so it never queues behind a
 * save. It starts when the picker opens (the popup searches for '' on open)
 * or when selected ids need their labels; typing restarts at the first page
 * after a short debounce, `onLoadMore` appends the next page, and a scope
 * change (organization, caller, role, kind, purpose or filter) cancels the
 * old read. Selected records stay in the options across every search and
 * page. `known` holds labels the page already has for selected ids; they show
 * until the first answer.
 */
export function useJobEntityOptions(
  request: Request,
  selectedIds: string[],
  known: JobEntityOption[] = NO_OPTIONS,
): JobEntityOptionsState {
  const { activeOrgId, activeOrg } = useOrganization();
  const { profile } = useUserProfile();
  const scope = `${activeOrgId}:${profile?.id}:${activeOrg?.role}:${request.kind}:${request.purpose}:${request.clientId}:${request.projectId}:${request.siteId}`;
  const selectedKey = JSON.stringify(selectedIds);
  const [cursor, setCursor] = useState<{
    scope: string;
    query: string | null;
    offset: number;
    revision: number;
  }>({ scope, query: null, offset: 0, revision: 0 });
  const query = cursor.scope === scope ? cursor.query : null;
  const offset = cursor.scope === scope ? cursor.offset : 0;
  const [page, setPage] = useState<Page | null>(null);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [failedScope, setFailedScope] = useState<string | null>(null);
  const search = useCallback(
    (value: string) => {
      // The status row shows in the first frame, before the debounce ends.
      setPendingScope(scope);
      setCursor((current) => ({ scope, query: value, offset: 0, revision: current.revision + 1 }));
    },
    [scope],
  );

  useEffect(() => {
    if (!activeOrgId || (query === null && selectedKey === '[]')) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setPendingScope(scope);
        setFailedScope(null);
        void readInBackground(
          'entity-options',
          {
            organizationId: activeOrgId,
            kind: request.kind,
            purpose: request.purpose ?? 'filter',
            ...(request.clientId ? { clientId: request.clientId } : {}),
            ...(request.projectId ? { projectId: request.projectId } : {}),
            ...(request.siteId ? { siteId: request.siteId } : {}),
            query: query ?? '',
            offset,
            selectedIds: JSON.parse(selectedKey) as string[],
          },
          controller.signal,
        )
          .then((response) => {
            if (controller.signal.aborted) return;
            if (!response.success) {
              setFailedScope(scope);
              return;
            }
            setPage((previous) => {
              const prior = previous?.scope === scope ? previous : null;
              const retainedPage = prior && offset > 0 && prior.query === (query ?? '') ? prior.options : [];
              // A selected record keeps its label when a later page does not hold it.
              const selected = new Set(JSON.parse(selectedKey) as string[]);
              const retainedSelection = (prior?.options ?? []).filter((option) => selected.has(option.value));
              const options = [
                ...new Map(
                  [...retainedPage, ...retainedSelection, ...response.options, ...response.selected].map(
                    (option) => [option.value, option],
                  ),
                ).values(),
              ];
              return { scope, query: query ?? '', offset, options, hasMore: response.hasMore };
            });
          })
          .catch(() => {
            if (!controller.signal.aborted) setFailedScope(scope);
          })
          .finally(() => {
            if (!controller.signal.aborted) setPendingScope(null);
          });
      },
      query && offset === 0 ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // The primitive scope fields define the request; callers need not memoize its object.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `scope` holds every request field
  }, [scope, activeOrgId, query, offset, selectedKey, cursor.revision]);

  const current = page?.scope === scope ? page : null;
  const currentQuery = query ?? '';
  const failed = failedScope === scope;
  const options = useMemo(() => {
    if (!current) return known;
    if (current.query === currentQuery) return current.options;
    // A new search is pending: keep only the selected records visible.
    const selected = new Set(JSON.parse(selectedKey) as string[]);
    return current.options.filter((option) => selected.has(option.value));
  }, [current, currentQuery, known, selectedKey]);
  return {
    options,
    onSearchChange: search,
    loading: pendingScope === scope,
    loadError: failed ? LOAD_ERROR : undefined,
    onRetryLoad: failed
      ? () => {
          setPendingScope(scope);
          setCursor((previous) => ({ scope, query, offset, revision: previous.revision + 1 }));
        }
      : undefined,
    onLoadMore:
      current?.hasMore && current.query === currentQuery && pendingScope !== scope
        ? () => {
            setPendingScope(scope);
            setCursor((previous) => ({
              scope,
              query: currentQuery,
              offset: current.offset + PAGE_SIZE,
              revision: previous.revision + 1,
            }));
          }
        : undefined,
  };
}
