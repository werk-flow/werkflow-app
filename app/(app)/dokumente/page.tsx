import { RegionLoadError } from '@/components/shared/region-load-error';
import { loadDocumentPageContext } from '@/lib/documents/page-context';
import { parseListPage } from '@/lib/ui/list-pagination';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { DocumentLibraryContent } from '@/components/dokumente/document-library-content';
import {
  DOKUMENTE_SUBTITLE,
  DokumenteContentSkeleton,
} from '@/components/loading-states/dokumente-page-skeleton';
import { PageHeaderSlot, PageHeaderSlotProvider } from '@/components/shared/page-action';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { getCachedMemberships, getCachedUser } from '@/lib/data/cached';
import { getDocumentFolderOptions, getDocumentDetails, getDocumentLibrary } from '@/lib/documents/actions';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import type { OrgRole } from '@/lib/members/actions';
import type {
  DocumentLibraryCategoryFilter,
  DocumentLibraryLinkFilter,
  DocumentLibrarySort,
  DocumentLibraryView,
} from '@/lib/documents/types';

type DokumentePageProps = {
  searchParams?: Promise<{
    page?: string;
    folderPage?: string;
    folder?: string;
    view?: string;
    q?: string;
    sort?: string;
    category?: string;
    link?: string;
    document?: string;
  }>;
};

function getDocumentView(value?: string): DocumentLibraryView {
  if (
    value === 'all' ||
    value === 'unorganized' ||
    value === 'work' ||
    value === 'jobs' ||
    value === 'projects' ||
    value === 'clients' ||
    value === 'employees' ||
    value === 'folders' ||
    value === 'photos' ||
    value === 'contracts' ||
    value === 'invoices' ||
    value === 'offers' ||
    value === 'reports' ||
    value === 'other' ||
    value === 'trash'
  ) {
    return value;
  }

  return 'folders';
}

function getDocumentSort(value?: string): DocumentLibrarySort {
  if (
    value === 'name' ||
    value === 'created_at' ||
    value === 'updated_at' ||
    value === 'size_bytes' ||
    value === 'type' ||
    value === 'category'
  ) {
    return value;
  }

  return 'name';
}

function getDocumentCategoryFilter(value?: string): DocumentLibraryCategoryFilter {
  if (
    value === 'photo' ||
    value === 'contract' ||
    value === 'invoice' ||
    value === 'offer' ||
    value === 'report' ||
    value === 'other'
  ) {
    return value;
  }

  return 'all';
}

function getDocumentLinkFilter(value?: string): DocumentLibraryLinkFilter {
  if (
    value === 'unlinked' ||
    value === 'jobs' ||
    value === 'projects' ||
    value === 'clients' ||
    value === 'employees'
  ) {
    return value;
  }

  return 'all';
}

async function DokumenteData({
  page,
  folderPage,
  folderId,
  view,
  searchQuery,
  sort,
  category,
  linkFilter,
  initialDocumentId,
}: {
  page: number;
  folderPage: number;
  folderId: string | null;
  view: DocumentLibraryView;
  searchQuery: string;
  sort: DocumentLibrarySort;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  initialDocumentId: string | null;
}) {
  const [libraryResult, folderOptionsResult, initialDocumentResult] = await Promise.all([
    getDocumentLibrary({
      page,
      folderPage,
      folderId,
      view,
      searchQuery,
      sort,
      category,
      linkFilter,
    }),
    getDocumentFolderOptions(),
    initialDocumentId ? getDocumentDetails(initialDocumentId) : Promise.resolve(null),
  ]);

  // The folder list feeds the move dialog; without it every folder would look empty.
  if (!libraryResult.success || !folderOptionsResult.success) {
    return (
      <RegionLoadError title="Dokumente konnten nicht geladen werden">
        Die Dokumentenbibliothek ist gerade nicht erreichbar. Deine Dateien sind davon nicht betroffen.
      </RegionLoadError>
    );
  }

  const allFolders = folderOptionsResult.folders;
  const { jobs, projects, clients, employees } =
    view === 'work'
      ? await loadDocumentPageContext(libraryResult.documents)
      : { jobs: [], projects: [], clients: [], employees: [] };
  const initialDocument = initialDocumentResult?.document ?? null;

  return (
    <DocumentLibraryContent
      page={page}
      total={libraryResult.total}
      folderPage={folderPage}
      folderTotal={libraryResult.folderTotal}
      view={view}
      searchQuery={searchQuery}
      category={category}
      linkFilter={linkFilter}
      currentFolderId={folderId}
      breadcrumbs={libraryResult.breadcrumbs}
      folders={libraryResult.folders}
      allFolders={allFolders}
      documents={libraryResult.documents}
      jobs={jobs}
      projects={projects}
      clients={clients}
      employees={employees}
      initialDocumentId={initialDocumentId}
      initialDocument={initialDocument}
      initialDocumentUnavailable={Boolean(initialDocumentId) && !initialDocument}
    />
  );
}

export default async function DokumentePage({ searchParams }: DokumentePageProps) {
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([getCachedUser(), cookies()]);

  if (!user) redirect('/login');

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ]);
  const resolvedSearchParams = searchParams ? await searchParams : {};

  if (!activeOrgId) {
    return (
      <PageShell>
        <PageHeader title="Dokumente" />
        <PageBody>
          <p className="text-muted-foreground">Bitte wähle zuerst eine Organisation aus.</p>
        </PageBody>
      </PageShell>
    );
  }

  const currentMembership = memberships.find((member) => member.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  const folderId = resolvedSearchParams.folder?.trim() || null;
  const view = folderId ? 'folders' : getDocumentView(resolvedSearchParams.view);
  const searchQuery = resolvedSearchParams.q?.trim() || '';
  const sort = getDocumentSort(resolvedSearchParams.sort);
  const category = getDocumentCategoryFilter(resolvedSearchParams.category);
  const linkFilter = getDocumentLinkFilter(resolvedSearchParams.link);
  const initialDocumentId = resolvedSearchParams.document?.trim() || null;

  // The header paints before the data. Its action menu needs the loaded
  // library, so the suspended content fills the header slot.
  return (
    <PageHeaderSlotProvider>
      <PageShell>
        <PageHeader title="Dokumente" subtitle={DOKUMENTE_SUBTITLE} actions={<PageHeaderSlot />} />
        <PageBody>
          <Suspense fallback={<DokumenteContentSkeleton />}>
            <DokumenteData
              page={parseListPage(resolvedSearchParams.page)}
              folderPage={parseListPage(resolvedSearchParams.folderPage)}
              folderId={folderId}
              view={view}
              searchQuery={searchQuery}
              sort={sort}
              category={category}
              linkFilter={linkFilter}
              initialDocumentId={initialDocumentId}
            />
          </Suspense>
        </PageBody>
      </PageShell>
    </PageHeaderSlotProvider>
  );
}
