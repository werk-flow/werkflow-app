import type { MouseEvent as ReactMouseEvent } from 'react';

import type {
  DocumentLibraryCategoryFilter,
  DocumentLibraryLinkFilter,
  DocumentLibraryView,
} from '@/lib/documents/types';

/** URLs of the document library's views, folders and searches. */

export function getFolderHref(folderId: string | null): string {
  return folderId ? `/dokumente?folder=${encodeURIComponent(folderId)}` : '/dokumente';
}

export function shouldUseDefaultLinkBehavior(event: ReactMouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function getViewHref({
  view,
  searchQuery,
  category,
  linkFilter,
}: {
  view: DocumentLibraryView;
  searchQuery: string;
  category?: DocumentLibraryCategoryFilter;
  linkFilter?: DocumentLibraryLinkFilter;
}): string {
  const params = new URLSearchParams();
  params.set('view', view);
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  if (view === 'all' && category && category !== 'all') params.set('category', category);
  if (view === 'all' && linkFilter && linkFilter !== 'all') params.set('link', linkFilter);
  return `/dokumente?${params.toString()}`;
}

/** The URL of the current view or folder with a changed search or filter. */
export function getSearchHref({
  view,
  currentFolderId,
  searchQuery,
  category,
  linkFilter,
}: {
  view: DocumentLibraryView;
  currentFolderId: string | null;
  searchQuery: string;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
}): string {
  const params = new URLSearchParams();
  if (view !== 'folders') params.set('view', view);
  if (currentFolderId) params.set('folder', currentFolderId);
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  if (view === 'all' && category !== 'all') {
    params.set('category', category);
  }
  if (view === 'all' && linkFilter !== 'all') {
    params.set('link', linkFilter);
  }
  return `/dokumente${params.size > 0 ? `?${params.toString()}` : ''}`;
}
