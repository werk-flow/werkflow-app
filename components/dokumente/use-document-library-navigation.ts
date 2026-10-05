'use client';

import { useEffect, useRef, useState, type TransitionStartFunction } from 'react';
import { useRouter } from 'next/navigation';

import type {
  DocumentLibraryCategoryFilter,
  DocumentLibraryLinkFilter,
  DocumentLibraryView,
} from '@/lib/documents/types';
import { getFolderHref, getSearchHref, getViewHref } from './document-library-links';

type PendingDocumentNavigation = {
  view: DocumentLibraryView;
  folderId: string | null;
} | null;

type SearchLocation = {
  searchQuery: string;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
};

function isSameSearchLocation(left: SearchLocation, right: SearchLocation): boolean {
  return (
    left.searchQuery === right.searchQuery &&
    left.category === right.category &&
    left.linkFilter === right.linkFilter
  );
}

export type DocumentLocationTarget = {
  href: string;
  targetView: DocumentLibraryView;
  targetFolderId: string | null;
};

/**
 * Folder, view and search navigation of the library. The target view shows
 * its skeleton at once (`pendingNavigation`) while the route transition loads.
 * The transition itself comes from `document-library-content.tsx`, the
 * library's named `useTransition` exception.
 */
export function useDocumentLibraryNavigation({
  view,
  initialSearchQuery,
  category,
  linkFilter,
  currentFolderId,
  page,
  folderPage,
  isMutating,
  isNavigationPending,
  startNavigationTransition,
  clearSelection,
}: {
  view: DocumentLibraryView;
  initialSearchQuery: string;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  currentFolderId: string | null;
  page: number;
  folderPage: number;
  isMutating: boolean;
  isNavigationPending: boolean;
  startNavigationTransition: TransitionStartFunction;
  clearSelection: () => void;
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  // The field follows the URL only when the URL's query changes. A filter,
  // folder or page navigation keeps the query, and its late commit must not
  // overwrite text typed in the meantime.
  const [shownUrlSearchQuery, setShownUrlSearchQuery] = useState(initialSearchQuery);
  if (shownUrlSearchQuery !== initialSearchQuery) {
    setShownUrlSearchQuery(initialSearchQuery);
    setSearchQuery(initialSearchQuery);
  }
  const [pendingNavigation, setPendingNavigation] = useState<PendingDocumentNavigation>(null);
  // The latest search location asked for. A second change while the first is
  // still loading builds on it, not on the route props it would revert.
  const requestedSearchLocation = useRef<SearchLocation>({
    searchQuery: initialSearchQuery.trim(),
    category,
    linkFilter,
  });

  useEffect(() => {
    requestedSearchLocation.current = { searchQuery: initialSearchQuery.trim(), category, linkFilter };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route props are the authoritative state after folder or filter navigation
    setPendingNavigation(null);
  }, [category, currentFolderId, initialSearchQuery, linkFilter, view, page, folderPage]);

  useEffect(() => {
    if (!pendingNavigation) return;

    const timeoutId = window.setTimeout(() => {
      setPendingNavigation(null);
    }, 10000);

    return () => window.clearTimeout(timeoutId);
  }, [pendingNavigation]);

  function navigateToDocumentLocation({ href, targetView, targetFolderId }: DocumentLocationTarget) {
    if (isMutating || isNavigationPending) {
      return;
    }
    if (targetView === view && targetFolderId === currentFolderId) return;

    setPendingNavigation({ view: targetView, folderId: targetFolderId });
    clearSelection();
    startNavigationTransition(() => {
      router.push(href);
    });
  }

  function navigateToFolder(folderId: string | null) {
    navigateToDocumentLocation({
      href: folderId
        ? getFolderHref(folderId)
        : getViewHref({
            view: 'folders',
            searchQuery,
            category,
            linkFilter,
          }),
      targetView: 'folders',
      targetFolderId: folderId,
    });
  }

  function updateSearch({
    nextSearchQuery = searchQuery,
    nextCategory,
    nextLinkFilter,
  }: {
    nextSearchQuery?: string;
    nextCategory?: DocumentLibraryCategoryFilter;
    nextLinkFilter?: DocumentLibraryLinkFilter;
  } = {}) {
    const requested = requestedSearchLocation.current;
    const next: SearchLocation = {
      searchQuery: nextSearchQuery.trim(),
      category: nextCategory ?? requested.category,
      linkFilter: nextLinkFilter ?? requested.linkFilter,
    };
    if (isSameSearchLocation(next, requested)) return;
    requestedSearchLocation.current = next;
    // Returning to the shown location leaves the route props unchanged, so a
    // pending skeleton would never clear.
    const returnsToShownLocation = isSameSearchLocation(next, {
      searchQuery: initialSearchQuery.trim(),
      category,
      linkFilter,
    });
    setPendingNavigation(
      returnsToShownLocation ? null : { view: currentFolderId ? 'folders' : view, folderId: currentFolderId },
    );
    const href = getSearchHref({ view, currentFolderId, ...next });
    startNavigationTransition(() => {
      router.replace(href);
    });
  }

  return {
    searchQuery,
    setSearchQuery,
    /** The view a pending navigation leads to; null when none is pending. */
    pendingView: pendingNavigation ? pendingNavigation.view : null,
    visibleView: pendingNavigation?.view ?? view,
    isNavigationPending,
    navigateToDocumentLocation,
    navigateToFolder,
    updateSearch,
  };
}
