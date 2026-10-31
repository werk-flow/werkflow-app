import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import type { ClientManagerContext } from '@/lib/clients/manager-access';
import { logError } from '@/lib/logging';
import { readInBatches } from '@/lib/supabase/query-batches';
import { customerJobHref, firstRelation, profileName } from './relationship-labels';
import { buildTimelinePage, decodeTimelineCursor, isTimelineCursorSafe, timelineItemKey } from './resolution';
import { TIMELINE_PAGE_SIZE, type CustomerRelationshipBundle, type TimelineItem } from './types';

const REQUEST_EVENT_LABELS: Record<string, string> = {
  updated: 'Anfrage bearbeitet',
  matched: 'Kunde zugeordnet',
  status_changed: 'Status geändert',
  promoted: 'Kunde aus Anfrage angelegt',
  closed: 'Anfrage geschlossen',
  reopened: 'Anfrage wieder geöffnet',
  linked: 'Anfrage verknüpft',
  converted: 'Anfrage in Arbeit überführt',
};

const FOLLOW_UP_EVENT_LABELS: Record<string, string> = {
  created: 'Nachfassaktion angelegt',
  updated: 'Nachfassaktion bearbeitet',
  completed: 'Nachfassaktion erledigt',
  cancelled: 'Nachfassaktion abgebrochen',
  reopened: 'Nachfassaktion wieder geöffnet',
};

const COMMUNICATION_EVENT_LABELS: Record<string, string> = {
  settings_created: 'Allgemeine Kontaktvorgaben angelegt',
  settings_updated: 'Allgemeine Kontaktvorgaben geändert',
  preference_created: 'Kontaktpräferenz angelegt',
  preference_updated: 'Kontaktpräferenz geändert',
  preference_cleared: 'Kontaktpräferenz zurückgesetzt',
  exception_acknowledged: 'Begründete Kontaktausnahme dokumentiert',
};

function eventLabel(labels: Record<string, string>, eventType: string): string {
  return labels[eventType] ?? 'Änderung dokumentiert';
}

type CursorFilterQuery<Query> = {
  lt: (column: string, value: string) => Query;
  lte: (column: string, value: string) => Query;
  or: (filters: string) => Query;
};

function applyTimelineCursor<Query extends CursorFilterQuery<Query>>(
  query: Query,
  cursor: ReturnType<typeof decodeTimelineCursor>,
  kind: TimelineItem['kind'],
  timestampColumn: string,
  sourceColumn = 'id',
): Query {
  if (!cursor) return query;
  if (!isTimelineCursorSafe(cursor)) {
    throw new Error('Unsafe timeline cursor reached query construction.');
  }
  const separatorIndex = cursor.stableKey.indexOf(':');
  const cursorKind = cursor.stableKey.slice(0, separatorIndex);
  const cursorSourceId = cursor.stableKey.slice(separatorIndex + 1);
  if (kind > cursorKind) {
    return query.lt(timestampColumn, cursor.occurredAt);
  }
  if (kind < cursorKind) {
    return query.lte(timestampColumn, cursor.occurredAt);
  }
  return query.or(
    `${timestampColumn}.lt.${cursor.occurredAt},and(${timestampColumn}.eq.${cursor.occurredAt},${sourceColumn}.lt.${cursorSourceId})`,
  );
}

function timelineItem(input: Omit<TimelineItem, 'stableKey'>): TimelineItem {
  return {
    ...input,
    stableKey: timelineItemKey(input.kind, input.sourceId),
  };
}

type TimelineCursor = ReturnType<typeof decodeTimelineCursor>;
type AddTimelineItem = (item: Omit<TimelineItem, 'stableKey'>) => void;

// A first page reads unfiltered; a later page narrows every source to the rows after the cursor.
function applyTimelineCursorWhenPaged<Query extends CursorFilterQuery<Query>>(
  query: Query,
  cursor: TimelineCursor,
  kind: TimelineItem['kind'],
  timestampColumn: string,
  sourceColumn?: string,
): Query {
  if (!cursor?.occurredAt) return query;
  return applyTimelineCursor(query, cursor, kind, timestampColumn, sourceColumn);
}

/** The customer's own records and work of one timeline page, cursor applied. */
async function readTimelineRecordSources(
  context: ClientManagerContext,
  clientId: string,
  cursor: TimelineCursor,
) {
  const { admin, orgId } = context;
  const sourceLimit = TIMELINE_PAGE_SIZE + 1;
  const contactsQuery = admin
    .from('client_contacts')
    .select('id,name,is_active,created_at,created_by')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const sitesQuery = admin
    .from('client_sites')
    .select('id,name,is_active,created_at,created_by')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const jobsQuery = admin
    .from('jobs')
    .select(
      'id,project_id,job_number,title,created_at,created_by,projects!jobs_project_id_fkey(project_number)',
    )
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const projectsQuery = admin
    .from('projects')
    .select('id,project_number,name,created_at,created_by')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const [contactsResult, sitesResult, jobsResult, projectsResult] = await Promise.all([
    applyTimelineCursorWhenPaged(contactsQuery, cursor, 'contact_created', 'created_at'),
    applyTimelineCursorWhenPaged(sitesQuery, cursor, 'site_created', 'created_at'),
    applyTimelineCursorWhenPaged(jobsQuery, cursor, 'job_created', 'created_at'),
    applyTimelineCursorWhenPaged(projectsQuery, cursor, 'project_created', 'created_at'),
  ]);
  return { contactsResult, sitesResult, jobsResult, projectsResult };
}

/** The customer's requests and their event log of one timeline page, cursor applied. */
async function readTimelineRequestSources(
  context: ClientManagerContext,
  clientId: string,
  cursor: TimelineCursor,
) {
  const { admin, orgId } = context;
  const sourceLimit = TIMELINE_PAGE_SIZE + 1;
  const receivedRequestsQuery = admin
    .from('client_requests')
    .select('id,request_number,summary,received_at,created_by')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('received_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const closedRequestsQuery = admin
    .from('client_requests')
    .select('id,request_number,summary,closed_at,closed_by')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const convertedRequestsQuery = admin
    .from('client_requests')
    .select('id,request_number,summary,converted_at,converted_by,converted_job_id,converted_project_id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .not('converted_at', 'is', null)
    .order('converted_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const requestEventsQuery = admin
    .from('client_request_events')
    .select(
      'id,request_id,event_type,event_payload,created_at,created_by,client_requests!inner(client_id,request_number,summary)',
    )
    .eq('organization_id', orgId)
    .eq('client_requests.client_id', clientId)
    .neq('event_type', 'created')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const [receivedRequestsResult, closedRequestsResult, convertedRequestsResult, requestEventsResult] =
    await Promise.all([
      applyTimelineCursorWhenPaged(receivedRequestsQuery, cursor, 'request_received', 'received_at'),
      applyTimelineCursorWhenPaged(closedRequestsQuery, cursor, 'request_closed', 'closed_at'),
      applyTimelineCursorWhenPaged(convertedRequestsQuery, cursor, 'request_converted', 'converted_at'),
      applyTimelineCursorWhenPaged(requestEventsQuery, cursor, 'request_event', 'created_at'),
    ]);
  return { receivedRequestsResult, closedRequestsResult, convertedRequestsResult, requestEventsResult };
}

/** The document links of the customer, its jobs, projects and requests of one timeline page, cursor applied. */
async function readTimelineDocumentLinkSources(
  context: ClientManagerContext,
  clientId: string,
  cursor: TimelineCursor,
) {
  const { admin, orgId } = context;
  const sourceLimit = TIMELINE_PAGE_SIZE + 1;
  const directDocumentLinksQuery = admin
    .from('document_links')
    .select('id,document_id,created_at,created_by,documents!inner(id,display_name,deleted_at)')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('document_id', { ascending: false })
    .limit(sourceLimit);
  const jobDocumentLinksQuery = admin
    .from('document_links')
    .select(
      'id,document_id,created_at,created_by,documents!inner(id,display_name,deleted_at),jobs!inner(client_id)',
    )
    .eq('organization_id', orgId)
    .eq('jobs.client_id', clientId)
    .order('created_at', { ascending: false })
    .order('document_id', { ascending: false })
    .limit(sourceLimit);
  const projectDocumentLinksQuery = admin
    .from('document_links')
    .select(
      'id,document_id,created_at,created_by,documents!inner(id,display_name,deleted_at),projects!inner(client_id)',
    )
    .eq('organization_id', orgId)
    .eq('projects.client_id', clientId)
    .order('created_at', { ascending: false })
    .order('document_id', { ascending: false })
    .limit(sourceLimit);
  const requestDocumentLinksQuery = admin
    .from('document_links')
    .select(
      'id,document_id,created_at,created_by,documents!inner(id,display_name,deleted_at),client_requests!inner(client_id)',
    )
    .eq('organization_id', orgId)
    .eq('client_requests.client_id', clientId)
    .order('created_at', { ascending: false })
    .order('document_id', { ascending: false })
    .limit(sourceLimit);
  const pagedLinks = <Query extends CursorFilterQuery<Query>>(query: Query): Query =>
    applyTimelineCursorWhenPaged(query, cursor, 'document_linked', 'created_at', 'document_id');
  const [
    directDocumentLinksResult,
    jobDocumentLinksResult,
    projectDocumentLinksResult,
    requestDocumentLinksResult,
  ] = await Promise.all([
    pagedLinks(directDocumentLinksQuery),
    pagedLinks(jobDocumentLinksQuery),
    pagedLinks(projectDocumentLinksQuery),
    pagedLinks(requestDocumentLinksQuery),
  ]);
  return {
    directDocumentLinksResult,
    jobDocumentLinksResult,
    projectDocumentLinksResult,
    requestDocumentLinksResult,
  };
}

/** The follow-up and communication-preference event logs of one timeline page, cursor applied. */
async function readTimelineEventLogSources(
  context: ClientManagerContext,
  clientId: string,
  cursor: TimelineCursor,
) {
  const { admin, orgId } = context;
  const sourceLimit = TIMELINE_PAGE_SIZE + 1;
  const followUpEventsQuery = admin
    .from('client_follow_up_events')
    .select('id,follow_up_id,event_type,event_payload,created_at,actor_id,client_follow_ups!inner(title)')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const preferenceEventsQuery = admin
    .from('client_communication_preference_events')
    .select('id,event_type,event_payload,created_at,actor_id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(sourceLimit);
  const [followUpEventsResult, preferenceEventsResult] = await Promise.all([
    applyTimelineCursorWhenPaged(followUpEventsQuery, cursor, 'follow_up_event', 'created_at'),
    applyTimelineCursorWhenPaged(
      preferenceEventsQuery,
      cursor,
      'communication_preference_event',
      'created_at',
    ),
  ]);
  return { followUpEventsResult, preferenceEventsResult };
}

/** Runs every timeline source of one page in parallel; null after logging when any read fails. */
async function readTimelineSources(context: ClientManagerContext, clientId: string, cursor: TimelineCursor) {
  const { admin, orgId } = context;
  const [clientResult, records, requests, documentLinks, eventLogs] = await Promise.all([
    admin
      .from('clients')
      .select('id,name,created_at')
      .eq('organization_id', orgId)
      .eq('id', clientId)
      .single(),
    readTimelineRecordSources(context, clientId, cursor),
    readTimelineRequestSources(context, clientId, cursor),
    readTimelineDocumentLinkSources(context, clientId, cursor),
    readTimelineEventLogSources(context, clientId, cursor),
  ]);
  const sources = { clientResult, ...records, ...requests, ...documentLinks, ...eventLogs };

  const results = [
    sources.clientResult,
    sources.contactsResult,
    sources.sitesResult,
    sources.receivedRequestsResult,
    sources.closedRequestsResult,
    sources.convertedRequestsResult,
    sources.requestEventsResult,
    sources.jobsResult,
    sources.projectsResult,
    sources.directDocumentLinksResult,
    sources.jobDocumentLinksResult,
    sources.projectDocumentLinksResult,
    sources.requestDocumentLinksResult,
    sources.followUpEventsResult,
    sources.preferenceEventsResult,
  ];
  if (results.some((result) => result.error)) {
    logError('Failed to load complete customer timeline:', results.find((result) => result.error)?.error);
    return null;
  }

  return sources;
}

type TimelineSources = NonNullable<Awaited<ReturnType<typeof readTimelineSources>>>;

function addCustomerRecordItems(add: AddTimelineItem, clientId: string, sources: TimelineSources): void {
  const { clientResult, contactsResult, sitesResult } = sources;
  if (clientResult.data) {
    add({
      kind: 'customer_created',
      category: 'internal',
      sourceId: clientResult.data.id,
      occurredAt: clientResult.data.created_at,
      actorId: null,
      actorName: null,
      reference: clientResult.data.name,
      detail: null,
      sourceHref: `/kunden/${clientId}`,
      sourceAvailable: true,
      currentStateOnly: true,
      metadata: {},
    });
  }
  for (const contact of contactsResult.data ?? []) {
    add({
      kind: 'contact_created',
      category: 'internal',
      sourceId: contact.id,
      occurredAt: contact.created_at,
      actorId: contact.created_by,
      actorName: null,
      reference: contact.name,
      detail: contact.is_active ? null : 'Archiviert',
      sourceHref: `/kunden/${clientId}#ansprechpartner`,
      sourceAvailable: true,
      currentStateOnly: true,
      metadata: {},
    });
  }
  for (const site of sitesResult.data ?? []) {
    add({
      kind: 'site_created',
      category: 'internal',
      sourceId: site.id,
      occurredAt: site.created_at,
      actorId: site.created_by,
      actorName: null,
      reference: site.name,
      detail: site.is_active ? null : 'Archiviert',
      sourceHref: `/kunden/${clientId}#einsatzorte`,
      sourceAvailable: true,
      currentStateOnly: true,
      metadata: {},
    });
  }
}

function addRequestItems(add: AddTimelineItem, sources: TimelineSources): void {
  const { receivedRequestsResult, closedRequestsResult, convertedRequestsResult } = sources;
  for (const request of receivedRequestsResult.data ?? []) {
    add({
      kind: 'request_received',
      category: 'work',
      sourceId: request.id,
      occurredAt: request.received_at,
      actorId: request.created_by,
      actorName: null,
      reference: request.request_number ?? request.summary,
      detail: request.summary,
      sourceHref: `/anfragen/${request.id}`,
      sourceAvailable: true,
      currentStateOnly: false,
      metadata: {},
    });
  }
  for (const request of closedRequestsResult.data ?? []) {
    if (!request.closed_at) continue;
    add({
      kind: 'request_closed',
      category: 'work',
      sourceId: request.id,
      occurredAt: request.closed_at,
      actorId: request.closed_by,
      actorName: null,
      reference: request.request_number ?? request.summary,
      detail: request.summary,
      sourceHref: `/anfragen/${request.id}`,
      sourceAvailable: true,
      currentStateOnly: true,
      metadata: {},
    });
  }
  for (const request of convertedRequestsResult.data ?? []) {
    if (!request.converted_at) continue;
    add({
      kind: 'request_converted',
      category: 'work',
      sourceId: request.id,
      occurredAt: request.converted_at,
      actorId: request.converted_by,
      actorName: null,
      reference: request.request_number ?? request.summary,
      detail: request.summary,
      sourceHref: `/anfragen/${request.id}`,
      sourceAvailable: true,
      currentStateOnly: true,
      metadata: {
        convertedJobId: request.converted_job_id,
        convertedProjectId: request.converted_project_id,
      },
    });
  }
}

function addRequestEventItems(add: AddTimelineItem, sources: TimelineSources): void {
  for (const event of sources.requestEventsResult.data ?? []) {
    const request = firstRelation(event.client_requests);
    if (!request) continue;
    add({
      kind: 'request_event',
      category: 'work',
      sourceId: event.id,
      occurredAt: event.created_at,
      actorId: event.created_by,
      actorName: null,
      reference: request.request_number ?? request.summary,
      detail: eventLabel(REQUEST_EVENT_LABELS, event.event_type),
      sourceHref: `/anfragen/${event.request_id}`,
      sourceAvailable: true,
      currentStateOnly: false,
      metadata: {
        eventType: event.event_type,
        payload: event.event_payload,
      },
    });
  }
}

function addWorkItems(add: AddTimelineItem, sources: TimelineSources): void {
  const { jobsResult, projectsResult } = sources;
  for (const project of projectsResult.data ?? []) {
    add({
      kind: 'project_created',
      category: 'work',
      sourceId: project.id,
      occurredAt: project.created_at,
      actorId: project.created_by,
      actorName: null,
      reference: project.project_number ?? project.name,
      detail: project.name,
      sourceHref: project.project_number
        ? `/auftraege/projekt/${encodeURIComponent(project.project_number)}`
        : null,
      sourceAvailable: Boolean(project.project_number),
      currentStateOnly: true,
      metadata: {},
    });
  }
  for (const job of jobsResult.data ?? []) {
    const href = customerJobHref(job.job_number, firstRelation(job.projects)?.project_number);
    add({
      kind: 'job_created',
      category: 'work',
      sourceId: job.id,
      occurredAt: job.created_at,
      actorId: job.created_by,
      actorName: null,
      reference: job.job_number ?? job.title,
      detail: job.title,
      sourceHref: href,
      sourceAvailable: Boolean(href),
      currentStateOnly: true,
      metadata: {},
    });
  }
}

/** One item per document: its earliest link among the customer's own, job, project and request links. */
function addDocumentLinkItems(add: AddTimelineItem, sources: TimelineSources): void {
  const documentLinks = [
    ...(sources.directDocumentLinksResult.data ?? []),
    ...(sources.jobDocumentLinksResult.data ?? []),
    ...(sources.projectDocumentLinksResult.data ?? []),
    ...(sources.requestDocumentLinksResult.data ?? []),
  ];
  const earliestDocumentLink = new Map<string, (typeof documentLinks)[number]>();
  for (const link of documentLinks) {
    const existing = earliestDocumentLink.get(link.document_id);
    if (!existing || link.created_at < existing.created_at) {
      earliestDocumentLink.set(link.document_id, link);
    }
  }
  for (const link of earliestDocumentLink.values()) {
    const document = firstRelation(link.documents);
    if (!document) continue;
    add({
      kind: 'document_linked',
      category: 'documents',
      sourceId: link.document_id,
      occurredAt: link.created_at,
      actorId: link.created_by,
      actorName: null,
      reference: document.display_name,
      detail: document.deleted_at ? 'Im Papierkorb' : null,
      sourceHref: `/dokumente?document=${encodeURIComponent(link.document_id)}`,
      sourceAvailable: true,
      currentStateOnly: true,
      metadata: {},
    });
  }
}

function addEventLogItems(add: AddTimelineItem, clientId: string, sources: TimelineSources): void {
  for (const event of sources.followUpEventsResult.data ?? []) {
    const followUp = firstRelation(event.client_follow_ups);
    if (!followUp) continue;
    add({
      kind: 'follow_up_event',
      category: 'internal',
      sourceId: event.id,
      occurredAt: event.created_at,
      actorId: event.actor_id,
      actorName: null,
      reference: followUp.title,
      detail: eventLabel(FOLLOW_UP_EVENT_LABELS, event.event_type),
      sourceHref: `/kunden/${clientId}?followUp=${event.follow_up_id}#nachfassaktionen`,
      sourceAvailable: true,
      currentStateOnly: false,
      metadata: {
        eventType: event.event_type,
        payload: event.event_payload,
      },
    });
  }
  for (const event of sources.preferenceEventsResult.data ?? []) {
    add({
      kind: 'communication_preference_event',
      category: 'internal',
      sourceId: event.id,
      occurredAt: event.created_at,
      actorId: event.actor_id,
      actorName: null,
      reference: eventLabel(COMMUNICATION_EVENT_LABELS, event.event_type),
      detail: null,
      sourceHref: `/kunden/${clientId}#kontaktvorgaben`,
      sourceAvailable: true,
      currentStateOnly: false,
      metadata: {
        eventType: event.event_type,
        payload: event.event_payload,
      },
    });
  }
}

/** One page of the customer timeline with its actors named. The caller has established the manager context. */
export async function loadTimeline(
  context: ClientManagerContext,
  clientId: string,
  cursorValue?: string | null,
): Promise<ActionResult<{ timeline: CustomerRelationshipBundle['timeline'] }>> {
  const { admin } = context;
  const cursor = decodeTimelineCursor(cursorValue);
  if (cursorValue && !cursor) {
    return { success: false, error: 'timeline_cursor_invalid' };
  }

  const sources = await readTimelineSources(context, clientId, cursor);
  if (!sources) return { success: false, error: 'timeline_load_failed' };

  const candidates: TimelineItem[] = [];
  const actorIds = new Set<string>();
  const add: AddTimelineItem = (item) => {
    candidates.push(timelineItem(item));
    if (item.actorId) actorIds.add(item.actorId);
  };
  addCustomerRecordItems(add, clientId, sources);
  addRequestItems(add, sources);
  addRequestEventItems(add, sources);
  addWorkItems(add, sources);
  addDocumentLinkItems(add, sources);
  addEventLogItems(add, clientId, sources);

  const profilesResult = await readInBatches([...actorIds], (batch) =>
    admin
      .from('profiles')
      .select('id,first_name,last_name,email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to resolve timeline actors:', profilesResult.error);
    return { success: false, error: 'timeline_load_failed' };
  }
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  for (const item of candidates) {
    item.actorName = item.actorId ? profileName(profileById.get(item.actorId) ?? null) : 'Nicht erfasst';
  }

  return {
    success: true,
    timeline: buildTimelinePage(candidates, cursorValue, TIMELINE_PAGE_SIZE),
  };
}
