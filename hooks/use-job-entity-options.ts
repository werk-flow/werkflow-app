'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import type { ReadFailure } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { BackgroundReadInput } from '@/lib/data/background-reads';
import type { JobEntityOption, JobOptionRequest } from '@/lib/jobs/option-types';
import { z } from '@/lib/zod';

type Request = Pick<JobOptionRequest, 'kind' | 'purpose' | 'clientId' | 'projectId' | 'siteId'>;
export type JobEntityOptionsState = {
  options: JobEntityOption[];
  onSearchChange: (query: string) => void;
  loading: boolean;
  /** The failed page read; its retry reads the page again with the same text. */
  loadFailure: ReadFailure | null;
  onLoadMore: (() => void) | undefined;
};

const LOAD_ERROR = 'Die Auswahl konnte nicht geladen werden.';
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 150;
const NO_OPTIONS: JobEntityOption[] = [];

type Page = { scope: string; query: string; offset: number; options: JobEntityOption[]; hasMore: boolean };
type Cursor = { scope: string; query: string | null; offset: number; revision: number };
type PageRead = { scope: string; query: string | null; offset: number; selectedKey: string };

/** The selected ids: `selectedKey` is `JSON.stringify` of the caller's id list. */
const selectedIdsSchema = z.array(z.string());

/** The background read of one page of the picker's options. */
function entityOptionsInput(
  organizationId: string,
  request: Request,
  { query, offset, selectedKey }: PageRead,
): BackgroundReadInput<'entity-options'> {
  return {
    organizationId,
    kind: request.kind,
    purpose: request.purpose ?? 'filter',
    ...(request.clientId ? { clientId: request.clientId } : {}),
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.siteId ? { siteId: request.siteId } : {}),
    query: query ?? '',
    offset,
    selectedIds: selectedIdsSchema.parse(JSON.parse(selectedKey)),
  };
}

/** The page an answer produces: a continuation extends the same search, and selected records keep their labels. */
function nextEntityOptionsPage(
  previous: Page | null,
  response: { options: JobEntityOption[]; selected: JobEntityOption[]; hasMore: boolean },
  { scope, query, offset, selectedKey }: PageRead,
): Page {
  const prior = previous?.scope === scope ? previous : null;
  const retainedPage = prior && offset > 0 && prior.query === (query ?? '') ? prior.options : [];
  // A selected record keeps its label when a later page does not hold it.
  const selected = new Set(selectedIdsSchema.parse(JSON.parse(selectedKey)));
  const retainedSelection = (prior?.options ?? []).filter((option) => selected.has(option.value));
  const options = [
    ...new Map(
      [...retainedPage, ...retainedSelection, ...response.options, ...response.selected].map((option) => [
        option.value,
        option,
      ]),
    ).values(),
  ];
  return { scope, query: query ?? '', offset, options, hasMore: response.hasMore };
}

/** The options to show: the page's, or only the selected records while a new search is pending. */
function visibleEntityOptions(
  current: Page | null,
  currentQuery: string,
  known: JobEntityOption[],
  selectedKey: string,
): JobEntityOption[] {
  if (!current) return known;
  if (current.query === currentQuery) return current.options;
  // A new search is pending: keep only the selected records visible.
  const selected = new Set(selectedIdsSchema.parse(JSON.parse(selectedKey)));
  return current.options.filter((option) => selected.has(option.value));
}

/** The retry of a failed read and the next-page request, each restarting the read at its cursor. */
function entityOptionsControls({
  scope,
  query,
  offset,
  current,
  currentQuery,
  failed,
  pendingScope,
  setPendingScope,
  setCursor,
}: {
  scope: string;
  query: string | null;
  offset: number;
  current: Page | null;
  currentQuery: string;
  failed: boolean;
  pendingScope: string | null;
  setPendingScope: Dispatch<SetStateAction<string | null>>;
  setCursor: Dispatch<SetStateAction<Cursor>>;
}): Pick<JobEntityOptionsState, 'loadFailure' | 'onLoadMore'> {
  return {
    loadFailure: failed
      ? {
          message: LOAD_ERROR,
          retry: () => {
            setPendingScope(scope);
            setCursor((previous) => ({ scope, query, offset, revision: previous.revision + 1 }));
          },
          retrying: pendingScope === scope,
        }
      : null,
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
  const [cursor, setCursor] = useState<Cursor>({ scope, query: null, offset: 0, revision: 0 });
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
        const read = { scope, query, offset, selectedKey };
        void readInBackground(
          'entity-options',
          entityOptionsInput(activeOrgId, request, read),
          controller.signal,
        )
          .then((response) => {
            if (controller.signal.aborted) return;
            if (!response.success) {
              setFailedScope(scope);
              return;
            }
            setPage((previous) => nextEntityOptionsPage(previous, response, read));
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
  const options = useMemo(
    () => visibleEntityOptions(current, currentQuery, known, selectedKey),
    [current, currentQuery, known, selectedKey],
  );
  return {
    options,
    onSearchChange: search,
    loading: pendingScope === scope,
    ...entityOptionsControls({
      scope,
      query,
      offset,
      current,
      currentQuery,
      failed: failedScope === scope,
      pendingScope,
      setPendingScope,
      setCursor,
    }),
  };
}
