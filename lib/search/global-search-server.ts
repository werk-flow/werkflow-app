import 'server-only';

import { readCustomerPage, readCustomerSearchMatches } from '@/lib/clients/list-page-server';
import { formatSiteAddress } from '@/lib/clients/types';
import { getDocumentLibrary } from '@/lib/documents/library-actions';
import { DOCUMENT_CATEGORY_LABELS } from '@/lib/documents/types';
import { findAssignedEquipment } from '@/lib/installed-equipment/assigned-equipment-reads';
import { getInstalledEquipmentPage } from '@/lib/installed-equipment/list-page-server';
import { fieldEquipmentAnchor } from '@/lib/installed-equipment/types';
import { JOB_LIST_SECTIONS, type JobListQueries, type JobListQuery } from '@/lib/jobs/list-page';
import { loadJobListPage } from '@/lib/jobs/list-server';
import { jobDetailHref, projectDetailHref } from '@/lib/jobs/routes';
import { logError } from '@/lib/logging';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';
import { readRequestPage } from '@/lib/requests/list-page-server';
import {
  GLOBAL_SEARCH_LIMIT,
  hitDetail,
  SEARCH_SOURCE_GROUPS,
  searchListHref,
  searchSourcesFor,
  type GlobalSearchInput,
  type GlobalSearchResult,
  type SearchGroup,
  type SearchGroupKind,
  type SearchHit,
  type SearchSource,
} from './global-search';

type LoadedGroup = Extract<SearchGroup, { status: 'loaded' }>;

function loaded(
  kind: SearchGroupKind,
  source: SearchSource,
  query: string,
  hits: SearchHit[],
  total: number | null,
  moreHref: string | null = searchListHref(source, query),
): LoadedGroup {
  return { kind, source, status: 'loaded', hits, total, moreHref };
}

/**
 * Kunden through the customer list reader; Einsatzorte and Ansprechpartner
 * through the customer domain's own match of them, each limited on its own.
 */
async function searchCustomers(context: ActionContext, query: string): Promise<SearchGroup[]> {
  const [page, matches] = await Promise.all([
    readCustomerPage(
      { organizationId: context.orgId, page: 1, search: query, view: 'aktiv' },
      GLOBAL_SEARCH_LIMIT,
    ),
    readCustomerSearchMatches(context.orgId, query, GLOBAL_SEARCH_LIMIT),
  ]);
  const customers = page.clients.map((client) => ({
    id: client.id,
    title: client.name,
    detail: hitDetail([client.customerNumber, client.phone, client.address]),
    href: `/kunden/${client.id}`,
  }));
  const sites = matches.sites.map((site) => ({
    id: site.id,
    title: site.name,
    detail: hitDetail([formatSiteAddress(site), site.clientName]),
    href: `/kunden/${site.clientId}`,
  }));
  const contacts = matches.contacts.map((contact) => ({
    id: contact.id,
    title: contact.name,
    detail: hitDetail([contact.clientName, contact.phone, contact.email]),
    href: `/kunden/${contact.clientId}`,
  }));
  return [
    loaded('kunden', 'kunden', query, customers, page.total),
    // The customer list counts customers, not their Objekte or contacts.
    loaded('einsatzorte', 'kunden', query, sites, null),
    loaded('ansprechpartner', 'kunden', query, contacts, null),
  ];
}

/**
 * Aufträge and Projekte through the job list reader, which shows an employee
 * only their assigned jobs and the projects that hold one. Open work comes
 * first, then parked, then finished.
 */
async function searchWork(query: string): Promise<SearchGroup[]> {
  const sectionQuery: JobListQuery = {
    page: 1,
    pageSize: GLOBAL_SEARCH_LIMIT,
    search: query,
    sort: 'datum',
    direction: 'desc',
    entryType: 'alle',
    status: 'alle',
    clientIds: [],
    employeeIds: [],
    dateFrom: '',
    dateTo: '',
    enabled: true,
  };
  const queries: JobListQueries = { active: sectionQuery, parked: sectionQuery, archived: sectionQuery };
  const { jobs, projects, clientMap, pagination } = await loadJobListPage(queries);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const clientName = (clientId: string | null): string | null =>
    (clientId ? clientMap[clientId] : null) ?? null;
  const hits = JOB_LIST_SECTIONS.flatMap((section) => pagination.pages[section].entries).flatMap(
    (entry): SearchHit[] => {
      if (entry.type === 'project') {
        const project = projectsById.get(entry.id);
        if (!project) return [];
        return [
          {
            id: project.id,
            title: project.name,
            detail: hitDetail([
              project.projectNumber ? `Projekt ${project.projectNumber}` : 'Projekt',
              clientName(project.clientId),
            ]),
            href: projectDetailHref(project),
          },
        ];
      }
      const job = jobsById.get(entry.id);
      if (!job) return [];
      return [
        {
          id: job.id,
          title: job.title || job.description || 'Auftrag',
          detail: hitDetail([job.jobNumber, clientName(job.clientId)]),
          href: jobDetailHref(job),
        },
      ];
    },
  );
  const total = JOB_LIST_SECTIONS.reduce((sum, section) => sum + pagination.pages[section].total, 0);
  return [loaded('auftraege', 'auftraege', query, hits.slice(0, GLOBAL_SEARCH_LIMIT), total)];
}

async function searchRequests(context: ActionContext, query: string): Promise<SearchGroup[]> {
  const page = await readRequestPage(
    context.orgId,
    { status: 'alle', search: query, page: 1 },
    GLOBAL_SEARCH_LIMIT,
  );
  const hits = page.entries.map(({ request, clientName }) => ({
    id: request.id,
    title: request.summary,
    detail: hitDetail([request.requestNumber, request.callerName, clientName]),
    href: `/anfragen/${request.id}`,
  }));
  return [loaded('anfragen', 'anfragen', query, hits, page.total)];
}

async function searchEquipment(query: string): Promise<SearchGroup[]> {
  const result = await getInstalledEquipmentPage(
    { search: query, category: 'all', includeArchived: false, page: 1 },
    GLOBAL_SEARCH_LIMIT,
  );
  if (!result.success) throw new Error(result.error ?? 'installed_equipment_load_failed');
  const hits = result.page.equipment.map((item) => ({
    id: item.id,
    title: item.name,
    detail: hitDetail([item.equipmentNumber, item.siteName, item.clientName]),
    href: `/service/anlagen/${encodeURIComponent(item.equipmentNumber)}`,
  }));
  return [loaded('anlagen', 'anlagen', query, hits, result.page.total)];
}

/**
 * A field worker's Anlagen: those linked to a job they are assigned to, through
 * the work pack's reach. A hit opens the job's work pack at the Anlage; the
 * equipment list is the office's, so there is no „Alle anzeigen“.
 */
async function searchAssignedEquipment(context: ActionContext, query: string): Promise<SearchGroup[]> {
  const { hits, total } = await findAssignedEquipment(context, query, GLOBAL_SEARCH_LIMIT);
  return [
    loaded(
      'anlagen',
      'anlagen',
      query,
      hits.map((hit) => ({
        id: hit.id,
        title: hit.name,
        detail: hitDetail([hit.equipmentNumber, hit.job.jobNumber ? `Auftrag ${hit.job.jobNumber}` : null]),
        href: `${jobDetailHref(hit.job, hit.job.project)}#${fieldEquipmentAnchor(hit.id)}`,
      })),
      total,
      null,
    ),
  ];
}

async function searchDocuments(query: string): Promise<SearchGroup[]> {
  const result = await getDocumentLibrary({
    view: 'all',
    searchQuery: query,
    page: 1,
    pageSize: GLOBAL_SEARCH_LIMIT,
  });
  if (!result.success) throw new Error(result.error ?? 'documents_failed');
  const hits = result.documents.map((document) => ({
    id: document.id,
    title: document.displayName,
    detail: hitDetail([
      document.origin.sourceReference ? `Nummer im Altsystem ${document.origin.sourceReference}` : null,
      DOCUMENT_CATEGORY_LABELS[document.category],
    ]),
    href: `/dokumente?document=${encodeURIComponent(document.id)}`,
  }));
  return [loaded('dokumente', 'dokumente', query, hits, result.total)];
}

function readSource(source: SearchSource, context: ActionContext, query: string): Promise<SearchGroup[]> {
  switch (source) {
    case 'kunden':
      return searchCustomers(context, query);
    case 'auftraege':
      return searchWork(query);
    case 'anfragen':
      return searchRequests(context, query);
    case 'anlagen':
      return context.isManagerOrAbove ? searchEquipment(query) : searchAssignedEquipment(context, query);
    case 'dokumente':
      return searchDocuments(query);
  }
}

/** A failed source fails its own groups; the others still answer. */
async function searchSource(
  source: SearchSource,
  context: ActionContext,
  query: string,
): Promise<SearchGroup[]> {
  try {
    return await readSource(source, context, query);
  } catch (error) {
    logError(`searchEverywhere: the ${source} search failed`, error);
    return SEARCH_SOURCE_GROUPS[source].map((kind) => ({ kind, source, status: 'failed' as const }));
  }
}

/**
 * The header search: the query through each domain's own list reader, as the
 * caller's role reaches it in the active organization. Identity, organization
 * and role come from the server; the client sends only the query and the
 * active organization, which must match. A failed identity check fails the
 * whole search, never as an empty result.
 */
export async function searchEverywhere(input: GlobalSearchInput): Promise<GlobalSearchResult> {
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (auth.context.orgId !== input.organizationId) return { success: false, error: 'organization_changed' };
  const allowed = searchSourcesFor(auth.context.isManagerOrAbove);
  const requested = input.sources;
  const sources = requested ? allowed.filter((source) => requested.includes(source)) : allowed;
  const groups = await Promise.all(sources.map((source) => searchSource(source, auth.context, input.query)));
  return { success: true, query: input.query, groups: groups.flat() };
}
