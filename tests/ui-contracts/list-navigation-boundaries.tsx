import { useListNavigation } from '@/hooks/use-list-navigation';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListPagination } from '@/components/shared/list-pagination';
import { parseListPage } from '@/lib/ui/list-pagination';
import { DocumentLibraryToolbar } from '@/components/dokumente/document-library-toolbar';
import { useDocumentLibraryNavigation } from '@/components/dokumente/use-document-library-navigation';
import type { DocumentLibraryLinkFilter } from '@/lib/documents/types';
import { useSearchParams } from './list-navigation-service-boundaries';

function ListControls(): React.JSX.Element {
  const navigation = useListNavigation();
  const searchParams = useSearchParams();
  return (
    <main>
      <Input
        aria-label="Liste durchsuchen"
        onChange={(event) => navigation.navigate({ q: event.target.value, page: 1 }, 250)}
      />
      <Button onClick={() => navigation.navigate({ page: 2 })}>Zweite Seite laden</Button>
      <output aria-label="Listenstatus">{navigation.busy ? 'Wird geladen' : 'Bereit'}</output>
      <ListPagination
        label="Testliste"
        page={parseListPage(searchParams.get('page') ?? undefined)}
        total={61}
        busy={navigation.busy}
        onPageChange={(page) => navigation.navigate({ page })}
      />
    </main>
  );
}
export function ListNavigationFixture(): React.JSX.Element {
  return (
    <BannerProvider>
      <ListControls />
    </BannerProvider>
  );
}

/** The document library's search toolbar on its real navigation hook; the URL is the route state. */
export function DocumentSearchFixture(): React.JSX.Element {
  const searchParams = useSearchParams();
  const navigation = useDocumentLibraryNavigation({
    view: 'all',
    initialSearchQuery: searchParams.get('q') ?? '',
    category: 'all',
    linkFilter: (searchParams.get('link') ?? 'all') as DocumentLibraryLinkFilter,
    currentFolderId: null,
    page: 1,
    folderPage: 1,
    isMutating: false,
    isNavigationPending: false,
    startNavigationTransition: (callback) => {
      void callback();
    },
    clearSelection: () => undefined,
  });
  return (
    <main>
      <h1>Komponentenverträge</h1>
      <DocumentLibraryToolbar
        visibleView="all"
        searchQuery={navigation.searchQuery}
        category="all"
        linkFilter={(searchParams.get('link') ?? 'all') as DocumentLibraryLinkFilter}
        viewSwitch={null}
        selectionActions={null}
        onSearchQueryChange={navigation.setSearchQuery}
        onSubmitSearch={(query) =>
          navigation.updateSearch(query === undefined ? {} : { nextSearchQuery: query })
        }
        onCategoryChange={(nextCategory) => navigation.updateSearch({ nextCategory })}
        onLinkFilterChange={(nextLinkFilter) => navigation.updateSearch({ nextLinkFilter })}
      />
    </main>
  );
}
