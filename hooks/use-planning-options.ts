'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import { readInBackground } from '@/lib/data/background-read-client';
import type { PlanningOption, PlanningOptionRequest } from '@/lib/planning/option-types';

type OptionPage = {
  scope: string;
  query: string;
  offset: number;
  options: PlanningOption[];
  hasMore: boolean;
  defaultSelectedIds: string[];
};

type PlanningOptionsState = {
  /** The searchable select's props: one page of choices plus the retained selection. */
  select: {
    options: PlanningOption[];
    onSearchChange: (query: string) => void;
    onLoadMore: (() => void) | undefined;
    loading: boolean;
    loadError: string | undefined;
    /** Reads the failed page again with the same text. */
    onRetryLoad: (() => void) | undefined;
  };
  /** The caller's own selection, or the records resolved from `defaultUserIds` while it is null. */
  selectedIds: string[];
  /** Defaults are still unresolved; a caller may hold its submit until they are, or the read failed. */
  resolvingDefaults: boolean;
};

const LOAD_ERROR = 'Die Auswahl konnte nicht geladen werden.';
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 150;

/**
 * One bounded server search per picker, never a whole-company preload.
 * Selected identities survive every search and continuation page; a scope
 * change (organization, caller, role, kind or defaults) cancels the old read
 * and restarts at the first page. Reads start lazily when the picker opens,
 * or immediately when selected or default identities need their labels.
 *
 * `selectedIds` is null until the caller's user touched the selection; until
 * then the employee records resolved once from `defaultUserIds` are selected,
 * and a removed default is never restored by a later response.
 */
export function usePlanningOptions(
  kind: PlanningOptionRequest['kind'],
  selectedIds: string[] | null,
  defaultUserIds: string[] = [],
  enabled = true,
): PlanningOptionsState {
  const { activeOrgId, activeOrg } = useOrganization();
  const { profile } = useUserProfile();
  const selectedKey = JSON.stringify(selectedIds ?? []);
  const defaultsKey = JSON.stringify(defaultUserIds);
  const scope = `${activeOrgId}:${profile?.id}:${activeOrg?.role}:${kind}:${defaultsKey}`;
  const [cursor, setCursor] = useState<{
    scope: string;
    query: string | null;
    offset: number;
    revision: number;
  }>({ scope, query: null, offset: 0, revision: 0 });
  const query = cursor.scope === scope ? cursor.query : null;
  const offset = cursor.scope === scope ? cursor.offset : 0;
  const revision = cursor.revision;
  const [page, setPage] = useState<OptionPage | null>(null);
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [failedScope, setFailedScope] = useState<string | null>(null);
  const search = useCallback(
    (value: string) => {
      setPendingScope(scope);
      setCursor((current) => ({ scope, query: value, offset: 0, revision: current.revision + 1 }));
    },
    [scope],
  );

  useEffect(() => {
    if (!enabled || !activeOrgId || (query === null && selectedKey === '[]' && defaultsKey === '[]')) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setPendingScope(scope);
        setFailedScope(null);
        // Defaults resolve once per scope: a later read must not restore a removed choice.
        const defaults: string[] =
          pageRef.current?.scope === scope ? [] : (JSON.parse(defaultsKey) as string[]);
        void readInBackground(
          'planning-options',
          {
            organizationId: activeOrgId,
            kind,
            query: query ?? '',
            offset,
            selectedIds: JSON.parse(selectedKey) as string[],
            defaultUserIds: defaults,
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
              const known = previous?.scope === scope ? previous : null;
              const defaultSelectedIds = known
                ? known.defaultSelectedIds
                : response.selected
                    .filter((option) => option.userId && defaults.includes(option.userId))
                    .map((option) => option.value);
              const retainedPage = known && offset > 0 && known.query === (query ?? '') ? known.options : [];
              // Selected and default records keep their labels: a later page without them must not hide them.
              const selected = new Set([...(JSON.parse(selectedKey) as string[]), ...defaultSelectedIds]);
              const retainedSelection = (known?.options ?? []).filter((option) => selected.has(option.value));
              const options = [
                ...new Map(
                  [...retainedPage, ...retainedSelection, ...response.options, ...response.selected].map(
                    (option) => [option.value, option],
                  ),
                ).values(),
              ];
              return {
                scope,
                query: query ?? '',
                offset,
                options,
                hasMore: response.hasMore,
                defaultSelectedIds,
              };
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
  }, [activeOrgId, kind, scope, selectedKey, defaultsKey, query, offset, revision, enabled]);

  const current = page?.scope === scope ? page : null;
  const currentQuery = query ?? '';
  const failed = failedScope === scope;
  const effectiveSelectedIds = selectedIds ?? current?.defaultSelectedIds ?? [];
  return {
    select: {
      options:
        current?.query === currentQuery
          ? current.options
          : (current?.options ?? []).filter((option) => effectiveSelectedIds.includes(option.value)),
      onSearchChange: search,
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
      loading: pendingScope === scope,
      loadError: failed ? LOAD_ERROR : undefined,
      onRetryLoad: failed
        ? () => {
            setPendingScope(scope);
            setCursor((previous) => ({ scope, query, offset, revision: previous.revision + 1 }));
          }
        : undefined,
    },
    selectedIds: effectiveSelectedIds,
    // A failed read reports itself in the picker; it must not leave a submit silently disabled.
    // An explicit selection replaces the defaults, so it never waits for them.
    resolvingDefaults: enabled && selectedIds === null && defaultsKey !== '[]' && current === null && !failed,
  };
}
