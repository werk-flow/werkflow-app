'use client';

import type { DocumentLibraryCategoryFilter, DocumentLibraryLinkFilter } from '@/lib/documents/types';
import { DocumentLibrarySelectionActions } from './document-library-selection-actions';
import { DocumentLibraryToolbar } from './document-library-toolbar';
import { DocumentLibraryViewSwitch } from './document-library-view-switch';
import type { DocumentLibrary } from './use-document-library';

type DocumentLibraryContentToolbarProps = {
  library: DocumentLibrary;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  isNavigationPending: boolean;
};

/** The library page's toolbar, wired to the library state: view switch, search, selection actions, filters. */
export function DocumentLibraryContentToolbar({
  library,
  category,
  linkFilter,
  isNavigationPending,
}: DocumentLibraryContentToolbarProps) {
  const { isTrashView, selection, navigation, dropTargets, deleteActions } = library;
  const { searchQuery, visibleView } = navigation;

  return (
    <DocumentLibraryToolbar
      visibleView={visibleView}
      searchQuery={searchQuery}
      category={category}
      linkFilter={linkFilter}
      viewSwitch={
        <DocumentLibraryViewSwitch
          visibleView={visibleView}
          searchQuery={searchQuery}
          category={category}
          linkFilter={linkFilter}
          isMutating={library.isMutating}
          isNavigationPending={isNavigationPending}
          isTrashDragOver={dropTargets.isTrashDragOver}
          onNavigate={navigation.navigateToDocumentLocation}
          onTrashDragOverChange={dropTargets.setIsTrashDragOver}
          onTrashDrop={dropTargets.handleTrashDrop}
        />
      }
      selectionActions={
        selection.selectedItemCount > 0 &&
        visibleView !== 'work' && (
          <DocumentLibrarySelectionActions
            selectedItemCount={selection.selectedItemCount}
            isTrashView={isTrashView}
            isBusy={library.mutations.busy.anyBusy}
            canRestore={selection.selectedDocuments.length > 0}
            onClearSelection={selection.clearSelection}
            onRestore={deleteActions.handleBatchRestore}
            onMove={library.openBatchMoveSelectionDialog}
            onCopy={library.openBatchCopySelectionDialog}
            onDelete={deleteActions.handleBatchDelete}
          />
        )
      }
      onSearchQueryChange={navigation.setSearchQuery}
      onSubmitSearch={(query) =>
        navigation.updateSearch(query === undefined ? {} : { nextSearchQuery: query })
      }
      onCategoryChange={(nextCategory) => navigation.updateSearch({ nextCategory })}
      onLinkFilterChange={(nextLinkFilter) => navigation.updateSearch({ nextLinkFilter })}
    />
  );
}
