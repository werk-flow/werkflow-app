'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import type { ReadFailure } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type {
  PlanningOption,
  PlanningOptionRequest,
  PlanningOptionResult,
} from '@/lib/planning/option-types';

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
    /** The failed page read; its retry reads the page again with the same text. */
    loadFailure: ReadFailure | null;
  };
  /** The caller's own selection, or the records resolved from `defaultUserIds` while it is null. */
  selectedIds: string[];
  /** Defaults are still unresolved; a caller may hold its submit until they are, or the read failed. */
  resolvingDefaults: boolean;
};

const LOAD_ERROR = 'Die Auswahl konnte nicht geladen werden.';
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 150;

type OptionCursor = {
  scope: string;
  query: string | null;
  offset: number;
  revision: number;
};

/** The ids a key built with `JSON.stringify` from an id list holds. */
function idsFromKey(key: string): string[] {
  const parsed: unknown = JSON.parse(key);
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * The page a response produces: continuation pages extend the same search, and the selected and
 * default records keep their labels, because a later page without them must not hide them.
 */
function mergeOptionPage(
  previous: OptionPage | null,
  response: Extract<PlanningOptionResult, { success: true }>,
  read: { scope: string; query: string | null; offset: number; selectedKey: string; defaults: string[] },
): OptionPage {
  const { scope, query, offset, defaults } = read;
  const known = previous?.scope === scope ? previous : null;
  const defaultSelectedIds = known
    ? known.defaultSelectedIds
    : response.selected
        .filter((option) => option.userId && defaults.includes(option.userId))
        .map((option) => option.value);
  const retainedPage = known && offset > 0 && known.query === (query ?? '') ? known.options : [];
  const selected = new Set([...idsFromKey(read.selectedKey), ...defaultSelectedIds]);
  const retainedSelection = (known?.options ?? []).filter((option) => selected.has(option.value));
  const options = [
    ...new Map(
      [...retainedPage, ...retainedSelection, ...response.options, ...response.selected].map((option) => [
        option.value,
        option,
      ]),
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
}

/** Reads one page for the scope and merges it into the page state. An aborted read changes nothing. */
function readOptionPage(input: {
  organizationId: string;
  kind: PlanningOptionRequest['kind'];
  scope: string;
  query: string | null;
  offset: number;
  selectedKey: string;
  defaultsKey: string;
  signal: AbortSignal;
  pageRef: { readonly current: OptionPage | null };
  setPage: Dispatch<SetStateAction<OptionPage | null>>;
  setPendingScope: Dispatch<SetStateAction<string | null>>;
  setFailedScope: Dispatch<SetStateAction<string | null>>;
}): void {
  const { scope, query, offset, selectedKey, signal, setPendingScope, setFailedScope } = input;
  setPendingScope(scope);
  setFailedScope(null);
  // Defaults resolve once per scope: a later read must not restore a removed choice.
  const defaults: string[] = input.pageRef.current?.scope === scope ? [] : idsFromKey(input.defaultsKey);
  void readInBackground(
    'planning-options',
    {
      organizationId: input.organizationId,
      kind: input.kind,
      query: query ?? '',
      offset,
      selectedIds: idsFromKey(selectedKey),
      defaultUserIds: defaults,
    },
    signal,
  )
    .then((response) => {
      if (signal.aborted) return;
      if (!response.success) {
        setFailedScope(scope);
        return;
      }
      input.setPage((previous) =>
        mergeOptionPage(previous, response, { scope, query, offset, selectedKey, defaults }),
      );
    })
    .catch(() => {
      if (!signal.aborted) setFailedScope(scope);
    })
    .finally(() => {
      if (!signal.aborted) setPendingScope(null);
    });
}

/** The searchable select's props for the current page, with its continuation and retry. */
function optionSelectProps(input: {
  scope: string;
  query: string | null;
  offset: number;
  current: OptionPage | null;
  effectiveSelectedIds: string[];
  failed: boolean;
  pendingScope: string | null;
  search: (query: string) => void;
  setPendingScope: Dispatch<SetStateAction<string | null>>;
  setCursor: Dispatch<SetStateAction<OptionCursor>>;
}): PlanningOptionsState['select'] {
  const { scope, query, offset, current, pendingScope, setPendingScope, setCursor } = input;
  const currentQuery = query ?? '';
  return {
    options:
      current?.query === currentQuery
        ? current.options
        : (current?.options ?? []).filter((option) => input.effectiveSelectedIds.includes(option.value)),
    onSearchChange: input.search,
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
    loadFailure: input.failed
      ? {
          message: LOAD_ERROR,
          retry: () => {
            setPendingScope(scope);
            setCursor((previous) => ({ scope, query, offset, revision: previous.revision + 1 }));
          },
          retrying: pendingScope === scope,
        }
      : null,
  };
}

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
  const [cursor, setCursor] = useState<OptionCursor>({ scope, query: null, offset: 0, revision: 0 });
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
      () =>
        readOptionPage({
          organizationId: activeOrgId,
          kind,
          scope,
          query,
          offset,
          selectedKey,
          defaultsKey,
          signal: controller.signal,
          pageRef,
          setPage,
          setPendingScope,
          setFailedScope,
        }),
      query && offset === 0 ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeOrgId, kind, scope, selectedKey, defaultsKey, query, offset, revision, enabled]);

  const current = page?.scope === scope ? page : null;
  const failed = failedScope === scope;
  const effectiveSelectedIds = selectedIds ?? current?.defaultSelectedIds ?? [];
  return {
    select: optionSelectProps({
      scope,
      query,
      offset,
      current,
      effectiveSelectedIds,
      failed,
      pendingScope,
      search,
      setPendingScope,
      setCursor,
    }),
    selectedIds: effectiveSelectedIds,
    // A failed read reports itself in the picker; it must not leave a submit silently disabled.
    // An explicit selection replaces the defaults, so it never waits for them.
    resolvingDefaults: enabled && selectedIds === null && defaultsKey !== '[]' && current === null && !failed,
  };
}
