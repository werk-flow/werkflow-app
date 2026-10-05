'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { requireManagerAndClient, type ClientManagerContext } from '@/lib/clients/manager-access';
import { formatProfileName } from '@/lib/members/profile-name';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readInBatches } from '@/lib/supabase/query-batches';
import type { Database, Json } from '@/lib/supabase/database.types';
import {
  buildTimelinePage,
  decodeTimelineCursor,
  isTimelineCursorSafe,
  resolveCommunicationGuidance,
  timelineItemKey,
} from './resolution';
import {
  communicationExceptionInputSchema,
  communicationGuidanceInputSchema,
  communicationPreferenceInputSchema,
  communicationSettingsInputSchema,
  followUpInputSchema,
  followUpTransitionSchema,
} from './schemas';
import {
  FOLLOW_UP_PAGE_SIZE,
  TIMELINE_PAGE_SIZE,
  type ClientFollowUp,
  type CommunicationChannel,
  type CommunicationPreference,
  type CommunicationPreferenceInput,
  type CommunicationPurpose,
  type CommunicationSettings,
  type CommunicationSettingsInput,
  type CustomerRelationshipBundle,
  type FollowUpInput,
  type FollowUpOwner,
  type FollowUpSourceType,
  type FollowUpStatus,
  type RelationshipActionResult,
  type TimelineItem,
} from './types';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

type FollowUpRow = Database['public']['Tables']['client_follow_ups']['Row'];
type CommunicationSettingsRow = Database['public']['Tables']['client_communication_settings']['Row'];
type CommunicationPreferenceRow = Database['public']['Tables']['client_communication_preferences']['Row'];

type SourceReference = {
  label: string;
  href: string | null;
};

function toClientFollowUp(
  row: FollowUpRow,
  ownerName: string,
  ownerIsActiveManager: boolean,
  source: SourceReference | null,
): ClientFollowUp {
  return {
    id: row.id,
    clientId: row.client_id,
    sourceType: row.source_type as FollowUpSourceType | null,
    sourceId: row.source_id,
    sourceLabel: source?.label ?? (row.source_id ? 'Quelle nicht mehr verfügbar' : null),
    sourceHref: source?.href ?? null,
    title: row.title,
    note: row.note,
    ownerUserId: row.owner_user_id,
    ownerName,
    ownerIsActiveManager,
    dueAt: row.due_at,
    status: row.status as FollowUpStatus,
    resolutionNote: row.resolution_note,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
  };
}

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

function profileName(
  profile: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null,
): string {
  return profile ? formatProfileName(profile) : 'Nicht erfasst';
}

function firstRelation<T>(relation: T | T[] | null): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}

function settingsFromRow(row: CommunicationSettingsRow): CommunicationSettings {
  return {
    id: row.id,
    clientId: row.client_id,
    preferredContactId: row.preferred_contact_id,
    preferredChannel: row.preferred_channel as CommunicationChannel | null,
    doNotContactInstruction: row.do_not_contact_instruction,
    contactTimeNote: row.contact_time_note,
    languageNote: row.language_note,
    accessibilityNote: row.accessibility_note,
    sourceNote: row.source_note,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function preferenceFromRow(row: CommunicationPreferenceRow): CommunicationPreference {
  return {
    id: row.id,
    clientId: row.client_id,
    contactId: row.contact_id,
    channel: row.channel as CommunicationChannel,
    purpose: row.purpose as CommunicationPurpose,
    state: row.state as CommunicationPreference['state'],
    sourceNote: row.source_note,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
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

/** The customer's own records, requests, and work queries of one timeline page, cursor applied. */
function buildTimelineRecordQueries(context: ClientManagerContext, clientId: string, cursor: TimelineCursor) {
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

  return {
    contactsQuery: applyTimelineCursorWhenPaged(contactsQuery, cursor, 'contact_created', 'created_at'),
    sitesQuery: applyTimelineCursorWhenPaged(sitesQuery, cursor, 'site_created', 'created_at'),
    receivedRequestsQuery: applyTimelineCursorWhenPaged(
      receivedRequestsQuery,
      cursor,
      'request_received',
      'received_at',
    ),
    closedRequestsQuery: applyTimelineCursorWhenPaged(
      closedRequestsQuery,
      cursor,
      'request_closed',
      'closed_at',
    ),
    convertedRequestsQuery: applyTimelineCursorWhenPaged(
      convertedRequestsQuery,
      cursor,
      'request_converted',
      'converted_at',
    ),
    requestEventsQuery: applyTimelineCursorWhenPaged(
      requestEventsQuery,
      cursor,
      'request_event',
      'created_at',
    ),
    jobsQuery: applyTimelineCursorWhenPaged(jobsQuery, cursor, 'job_created', 'created_at'),
    projectsQuery: applyTimelineCursorWhenPaged(projectsQuery, cursor, 'project_created', 'created_at'),
  };
}

/** The document-link and event-log queries of one timeline page, cursor applied. */
function buildTimelineLinkAndEventQueries(
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

  return {
    directDocumentLinksQuery: applyTimelineCursorWhenPaged(
      directDocumentLinksQuery,
      cursor,
      'document_linked',
      'created_at',
      'document_id',
    ),
    jobDocumentLinksQuery: applyTimelineCursorWhenPaged(
      jobDocumentLinksQuery,
      cursor,
      'document_linked',
      'created_at',
      'document_id',
    ),
    projectDocumentLinksQuery: applyTimelineCursorWhenPaged(
      projectDocumentLinksQuery,
      cursor,
      'document_linked',
      'created_at',
      'document_id',
    ),
    requestDocumentLinksQuery: applyTimelineCursorWhenPaged(
      requestDocumentLinksQuery,
      cursor,
      'document_linked',
      'created_at',
      'document_id',
    ),
    followUpEventsQuery: applyTimelineCursorWhenPaged(
      followUpEventsQuery,
      cursor,
      'follow_up_event',
      'created_at',
    ),
    preferenceEventsQuery: applyTimelineCursorWhenPaged(
      preferenceEventsQuery,
      cursor,
      'communication_preference_event',
      'created_at',
    ),
  };
}

/** Runs every timeline source of one page in parallel; null after logging when any read fails. */
async function readTimelineSources(context: ClientManagerContext, clientId: string, cursor: TimelineCursor) {
  const { admin, orgId } = context;
  const recordQueries = buildTimelineRecordQueries(context, clientId, cursor);
  const linkAndEventQueries = buildTimelineLinkAndEventQueries(context, clientId, cursor);
  const [
    clientResult,
    contactsResult,
    sitesResult,
    receivedRequestsResult,
    closedRequestsResult,
    convertedRequestsResult,
    requestEventsResult,
    jobsResult,
    projectsResult,
    directDocumentLinksResult,
    jobDocumentLinksResult,
    projectDocumentLinksResult,
    requestDocumentLinksResult,
    followUpEventsResult,
    preferenceEventsResult,
  ] = await Promise.all([
    admin
      .from('clients')
      .select('id,name,created_at')
      .eq('organization_id', orgId)
      .eq('id', clientId)
      .single(),
    recordQueries.contactsQuery,
    recordQueries.sitesQuery,
    recordQueries.receivedRequestsQuery,
    recordQueries.closedRequestsQuery,
    recordQueries.convertedRequestsQuery,
    recordQueries.requestEventsQuery,
    recordQueries.jobsQuery,
    recordQueries.projectsQuery,
    linkAndEventQueries.directDocumentLinksQuery,
    linkAndEventQueries.jobDocumentLinksQuery,
    linkAndEventQueries.projectDocumentLinksQuery,
    linkAndEventQueries.requestDocumentLinksQuery,
    linkAndEventQueries.followUpEventsQuery,
    linkAndEventQueries.preferenceEventsQuery,
  ]);

  const results = [
    clientResult,
    contactsResult,
    sitesResult,
    receivedRequestsResult,
    closedRequestsResult,
    convertedRequestsResult,
    requestEventsResult,
    jobsResult,
    projectsResult,
    directDocumentLinksResult,
    jobDocumentLinksResult,
    projectDocumentLinksResult,
    requestDocumentLinksResult,
    followUpEventsResult,
    preferenceEventsResult,
  ];
  if (results.some((result) => result.error)) {
    logError('Failed to load complete customer timeline:', results.find((result) => result.error)?.error);
    return null;
  }

  return {
    clientResult,
    contactsResult,
    sitesResult,
    receivedRequestsResult,
    closedRequestsResult,
    convertedRequestsResult,
    requestEventsResult,
    jobsResult,
    projectsResult,
    directDocumentLinksResult,
    jobDocumentLinksResult,
    projectDocumentLinksResult,
    requestDocumentLinksResult,
    followUpEventsResult,
    preferenceEventsResult,
  };
}

type TimelineSources = NonNullable<Awaited<ReturnType<typeof readTimelineSources>>>;

function addTimelineRecordItems(add: AddTimelineItem, clientId: string, sources: TimelineSources): void {
  const {
    clientResult,
    contactsResult,
    sitesResult,
    receivedRequestsResult,
    closedRequestsResult,
    convertedRequestsResult,
    requestEventsResult,
  } = sources;
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
  for (const event of requestEventsResult.data ?? []) {
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

function addTimelineWorkAndEventItems(
  add: AddTimelineItem,
  clientId: string,
  sources: TimelineSources,
): void {
  const {
    jobsResult,
    projectsResult,
    directDocumentLinksResult,
    jobDocumentLinksResult,
    projectDocumentLinksResult,
    requestDocumentLinksResult,
    followUpEventsResult,
    preferenceEventsResult,
  } = sources;
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
    const parentProject = firstRelation(job.projects);
    const href = job.job_number
      ? parentProject?.project_number
        ? `/auftraege/projekt/${encodeURIComponent(parentProject.project_number)}/${encodeURIComponent(job.job_number)}`
        : `/auftraege/${encodeURIComponent(job.job_number)}`
      : null;
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

  const documentLinks = [
    ...(directDocumentLinksResult.data ?? []),
    ...(jobDocumentLinksResult.data ?? []),
    ...(projectDocumentLinksResult.data ?? []),
    ...(requestDocumentLinksResult.data ?? []),
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
  for (const event of followUpEventsResult.data ?? []) {
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
  for (const event of preferenceEventsResult.data ?? []) {
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

async function loadTimeline(
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
  addTimelineRecordItems(add, clientId, sources);
  addTimelineWorkAndEventItems(add, clientId, sources);

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

async function loadFollowUpOwners(
  context: ClientManagerContext,
): Promise<ActionResult<{ owners: FollowUpOwner[]; managerUserIds: Set<string> }>> {
  const { data: memberships, error } = await context.admin
    .from('organization_members')
    .select('user_id,role')
    .eq('organization_id', context.orgId)
    .in('role', ['admin', 'buero']);
  if (error) {
    logReadFailure('loadFollowUpOwners: manager memberships read failed', error);
    return { success: false, error: 'owners_load_failed' };
  }
  const userIds = (memberships ?? []).map((member) => member.user_id);
  const profilesResult = await readInBatches(userIds, (batch) =>
    context.admin
      .from('profiles')
      .select('id,first_name,last_name,email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logReadFailure('loadFollowUpOwners: profiles read failed', profilesResult.error);
    return { success: false, error: 'owners_load_failed' };
  }
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const owners: FollowUpOwner[] = (memberships ?? [])
    .map((member) => ({
      userId: member.user_id,
      role: member.role as FollowUpOwner['role'],
      name: profileName(profileById.get(member.user_id) ?? null),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'));
  return { success: true, owners, managerUserIds: new Set(userIds) };
}

/** One follow-up's source through the batch reader, so both share one label and link rule. */
async function loadSingleFollowUpSource(
  context: ClientManagerContext,
  clientId: string,
  sourceType: FollowUpSourceType | null,
  sourceId: string | null,
): Promise<ActionResult<{ source: SourceReference | null }>> {
  if (!sourceType || !sourceId) return { success: true, source: null };
  const references = new Map<string, SourceReference>();
  const loaded = await loadFollowUpSourceReferences(context, clientId, sourceType, [sourceId], references);
  if (!loaded) return { success: false, error: 'source_load_failed' };
  return { success: true, source: references.get(`${sourceType}:${sourceId}`) ?? null };
}

/** Reads one source type's labels and links into `sourceReferences`; false after logging a failed read. */
async function loadFollowUpSourceReferences(
  context: ClientManagerContext,
  clientId: string,
  sourceType: FollowUpSourceType,
  ids: string[],
  sourceReferences: Map<string, SourceReference>,
): Promise<boolean> {
  if (ids.length === 0) return true;
  if (sourceType === 'contact') {
    const result = await readInBatches(ids, (batch) =>
      context.admin
        .from('client_contacts')
        .select('id,name')
        .in('id', [...batch])
        .eq('organization_id', context.orgId)
        .eq('client_id', clientId),
    );
    if (result.error) {
      logReadFailure(`loadFollowUps: ${sourceType} sources read failed`, result.error);
      return false;
    }
    for (const row of result.data ?? [])
      sourceReferences.set(`${sourceType}:${row.id}`, {
        label: row.name,
        href: `/kunden/${clientId}#ansprechpartner`,
      });
    return true;
  }
  if (sourceType === 'site') {
    const result = await readInBatches(ids, (batch) =>
      context.admin
        .from('client_sites')
        .select('id,name')
        .in('id', [...batch])
        .eq('organization_id', context.orgId)
        .eq('client_id', clientId),
    );
    if (result.error) {
      logReadFailure(`loadFollowUps: ${sourceType} sources read failed`, result.error);
      return false;
    }
    for (const row of result.data ?? [])
      sourceReferences.set(`${sourceType}:${row.id}`, {
        label: row.name,
        href: `/kunden/${clientId}#einsatzorte`,
      });
    return true;
  }
  if (sourceType === 'request') {
    const result = await readInBatches(ids, (batch) =>
      context.admin
        .from('client_requests')
        .select('id,request_number,summary')
        .in('id', [...batch])
        .eq('organization_id', context.orgId)
        .eq('client_id', clientId),
    );
    if (result.error) {
      logReadFailure(`loadFollowUps: ${sourceType} sources read failed`, result.error);
      return false;
    }
    for (const row of result.data ?? [])
      sourceReferences.set(`${sourceType}:${row.id}`, {
        label: row.request_number ?? row.summary,
        href: `/anfragen/${row.id}`,
      });
    return true;
  }
  if (sourceType === 'job') {
    const result = await readInBatches(ids, (batch) =>
      context.admin
        .from('jobs')
        .select('id,job_number,title,projects!jobs_project_id_fkey(project_number)')
        .in('id', [...batch])
        .eq('organization_id', context.orgId)
        .eq('client_id', clientId),
    );
    if (result.error) {
      logReadFailure(`loadFollowUps: ${sourceType} sources read failed`, result.error);
      return false;
    }
    for (const row of result.data ?? []) {
      const project = firstRelation(row.projects);
      const href = row.job_number
        ? project?.project_number
          ? `/auftraege/projekt/${encodeURIComponent(project.project_number)}/${encodeURIComponent(row.job_number)}`
          : `/auftraege/${encodeURIComponent(row.job_number)}`
        : null;
      sourceReferences.set(`${sourceType}:${row.id}`, {
        label: row.job_number ?? row.title,
        href,
      });
    }
    return true;
  }
  if (sourceType === 'service_case') {
    const result = await readInBatches(ids, (batch) =>
      context.admin
        .from('service_cases')
        .select('id,case_number,summary')
        .in('id', [...batch])
        .eq('organization_id', context.orgId)
        .eq('client_id', clientId),
    );
    if (result.error) {
      logReadFailure(`loadFollowUps: ${sourceType} sources read failed`, result.error);
      return false;
    }
    for (const row of result.data ?? []) {
      sourceReferences.set(`${sourceType}:${row.id}`, {
        label: `${row.case_number} · ${row.summary}`,
        href: `/service/faelle/${encodeURIComponent(row.case_number)}`,
      });
    }
    return true;
  }
  if (sourceType === 'maintenance_coverage') {
    const result = await readInBatches(ids, (batch) =>
      context.admin
        .from('maintenance_coverages')
        .select('id,coverage_number,reference')
        .in('id', [...batch])
        .eq('organization_id', context.orgId)
        .eq('client_id', clientId),
    );
    if (result.error) {
      logReadFailure(`loadFollowUps: ${sourceType} sources read failed`, result.error);
      return false;
    }
    for (const row of result.data ?? []) {
      sourceReferences.set(`${sourceType}:${row.id}`, {
        label: row.reference ? `${row.coverage_number} · ${row.reference}` : row.coverage_number,
        href: '/service/wartung',
      });
    }
    return true;
  }
  const result = await readInBatches(ids, (batch) =>
    context.admin
      .from('projects')
      .select('id,project_number,name')
      .in('id', [...batch])
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId),
  );
  if (result.error) {
    logReadFailure(`loadFollowUps: ${sourceType} sources read failed`, result.error);
    return false;
  }
  for (const row of result.data ?? [])
    sourceReferences.set(`${sourceType}:${row.id}`, {
      label: row.project_number ?? row.name,
      href: row.project_number ? `/auftraege/projekt/${encodeURIComponent(row.project_number)}` : null,
    });
  return true;
}

async function loadFollowUps(
  context: ClientManagerContext,
  clientId: string,
  owners: FollowUpOwner[],
  managerUserIds: Set<string>,
): Promise<ActionResult<{ followUps: ClientFollowUp[] }>> {
  const [openResult, historyResult] = await Promise.all([
    context.admin
      .from('client_follow_ups')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId)
      .eq('status', 'open')
      .order('due_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(FOLLOW_UP_PAGE_SIZE + 1),
    context.admin
      .from('client_follow_ups')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId)
      .in('status', ['completed', 'cancelled'])
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(20),
  ]);
  if (openResult.error || historyResult.error) {
    logReadFailure('loadFollowUps: follow-ups read failed', openResult.error ?? historyResult.error);
    return { success: false, error: 'follow_ups_load_failed' };
  }
  if ((openResult.data ?? []).length > FOLLOW_UP_PAGE_SIZE) {
    logReadFailure('loadFollowUps: open follow-ups of one customer exceeded the page', {
      code: 'follow_ups_capacity_exceeded',
      clientId,
    });
    return { success: false, error: 'follow_ups_capacity_exceeded' };
  }
  const rows = [...(openResult.data ?? []), ...(historyResult.data ?? [])];

  const ownerNameById = new Map(owners.map((owner) => [owner.userId, owner.name]));
  const sourceIdsByType = new Map<FollowUpSourceType, string[]>();
  for (const row of rows ?? []) {
    if (!row.source_type || !row.source_id) continue;
    const sourceType = row.source_type as FollowUpSourceType;
    sourceIdsByType.set(sourceType, [...(sourceIdsByType.get(sourceType) ?? []), row.source_id]);
  }

  const sourceReferences = new Map<string, SourceReference>();
  const sourceLoadResults = await Promise.all(
    [...sourceIdsByType.entries()].map(([sourceType, ids]) =>
      loadFollowUpSourceReferences(context, clientId, sourceType, [...new Set(ids)], sourceReferences),
    ),
  );
  if (sourceLoadResults.some((success) => !success)) {
    return { success: false, error: 'follow_up_sources_load_failed' };
  }

  return {
    success: true,
    followUps: (rows ?? []).map((row: FollowUpRow) => {
      const source =
        row.source_type && row.source_id
          ? (sourceReferences.get(`${row.source_type}:${row.source_id}`) ?? null)
          : null;
      return toClientFollowUp(
        row,
        ownerNameById.get(row.owner_user_id) ?? 'Ehemalige Zuständigkeit',
        managerUserIds.has(row.owner_user_id),
        source,
      );
    }),
  };
}

async function loadCommunicationConfiguration(
  context: ClientManagerContext,
  clientId: string,
): Promise<
  | {
      success: true;
      settings: CommunicationSettings | null;
      preferences: CommunicationPreference[];
    }
  | ActionFailure
> {
  const [settingsResult, preferencesResult] = await Promise.all([
    context.admin
      .from('client_communication_settings')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId)
      .maybeSingle(),
    context.admin
      .from('client_communication_preferences')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId)
      .order('contact_id', { ascending: true, nullsFirst: true })
      .order('channel', { ascending: true })
      .order('purpose', { ascending: true })
      .limit(251),
  ]);
  if (settingsResult.error || preferencesResult.error) {
    logReadFailure(
      'loadCommunicationConfiguration: communication read failed',
      settingsResult.error ?? preferencesResult.error,
    );
    return { success: false, error: 'communication_preferences_load_failed' };
  }
  if ((preferencesResult.data ?? []).length > 250) {
    logReadFailure('loadCommunicationConfiguration: preferences of one customer exceeded 250', {
      code: 'communication_preferences_capacity_exceeded',
      clientId,
    });
    return { success: false, error: 'communication_preferences_capacity_exceeded' };
  }
  return {
    success: true,
    settings: settingsResult.data ? settingsFromRow(settingsResult.data) : null,
    preferences: (preferencesResult.data ?? []).map(preferenceFromRow),
  };
}

// The ids and the timeline cursor a client sends, bounded before any read.
const relationshipTargetSchema = z.object({
  clientId: uuidSchema,
  followUpId: uuidSchema.optional(),
  cursor: z.string().max(2000).nullish(),
});

export async function getCustomerRelationshipBundle(
  rawClientId: string,
  rawCursor?: string | null,
): Promise<ActionResult<{ data: CustomerRelationshipBundle }>> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId, cursor: rawCursor });
  if (!target.success) return { success: false, error: 'input_invalid' };
  const { clientId, cursor } = target.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const [ownersResult, timelineResult, communicationResult] = await Promise.all([
    loadFollowUpOwners(auth.context),
    loadTimeline(auth.context, clientId, cursor),
    loadCommunicationConfiguration(auth.context, clientId),
  ]);
  if (!ownersResult.success) return ownersResult;
  if (!timelineResult.success) return timelineResult;
  if (!communicationResult.success) return communicationResult;
  const followUpsResult = await loadFollowUps(
    auth.context,
    clientId,
    ownersResult.owners,
    ownersResult.managerUserIds,
  );
  if (!followUpsResult.success) return followUpsResult;
  return {
    success: true,
    data: {
      timeline: timelineResult.timeline,
      followUps: followUpsResult.followUps,
      followUpOwners: ownersResult.owners,
      communicationSettings: communicationResult.settings,
      communicationPreferences: communicationResult.preferences,
    },
  };
}

export async function createCustomerFollowUp(
  rawClientId: string,
  input: FollowUpInput,
): Promise<RelationshipActionResult<ClientFollowUp>> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = followUpInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const validatedInput = parsed.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('create_client_follow_up', {
    p_organization_id: auth.context.orgId,
    p_client_id: clientId,
    p_title: validatedInput.title,
    p_note: validatedInput.note ?? '',
    p_owner_user_id: validatedInput.ownerUserId,
    p_due_at: new Date(validatedInput.dueAt).toISOString(),
    p_source_type: validatedInput.sourceType ?? null,
    p_source_id: validatedInput.sourceId ?? null,
    p_actor_id: auth.context.userId,
  });
  const { data, error } = await auth.context.admin.rpc('create_client_follow_up', args);
  if (error || !data) {
    logError('Failed to create customer follow-up:', error);
    return { success: false, error: 'create_failed' };
  }
  if (data.status !== 'open') {
    return { success: false, error: 'create_failed' };
  }
  const [ownersResult, sourceResult] = await Promise.all([
    loadFollowUpOwners(auth.context),
    loadSingleFollowUpSource(
      auth.context,
      clientId,
      data.source_type as FollowUpSourceType | null,
      data.source_id,
    ),
  ]);
  if (!ownersResult.success || !sourceResult.success) {
    return { success: false, error: 'reload_failed' };
  }
  const owner = ownersResult.owners.find((candidate) => candidate.userId === data.owner_user_id);
  return {
    success: true,
    data: toClientFollowUp(
      data as FollowUpRow,
      owner?.name ?? 'Ehemalige Zuständigkeit',
      ownersResult.managerUserIds.has(data.owner_user_id),
      sourceResult.source,
    ),
  };
}

export async function updateCustomerFollowUp(
  rawClientId: string,
  rawFollowUpId: string,
  input: FollowUpInput,
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema
    .required({ followUpId: true })
    .safeParse({ clientId: rawClientId, followUpId: rawFollowUpId });
  const parsed = followUpInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId, followUpId } = target.data;
  const validatedInput = parsed.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('update_client_follow_up', {
    p_follow_up_id: followUpId,
    p_organization_id: auth.context.orgId,
    p_title: validatedInput.title,
    p_note: validatedInput.note ?? '',
    p_owner_user_id: validatedInput.ownerUserId,
    p_due_at: new Date(validatedInput.dueAt).toISOString(),
    p_source_type: validatedInput.sourceType ?? null,
    p_source_id: validatedInput.sourceId ?? null,
    p_actor_id: auth.context.userId,
    p_reason: validatedInput.reason ?? null,
  });
  const { error } = await auth.context.admin.rpc('update_client_follow_up', args);
  if (error) {
    logError('Failed to update customer follow-up:', error);
    return { success: false, error: 'update_failed' };
  }
  return { success: true };
}

export async function transitionCustomerFollowUp(
  rawClientId: string,
  rawFollowUpId: string,
  targetStatus: FollowUpStatus,
  input: { resolutionNote?: string; reason?: string } = {},
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema
    .required({ followUpId: true })
    .safeParse({ clientId: rawClientId, followUpId: rawFollowUpId });
  const parsed = followUpTransitionSchema.safeParse({ targetStatus, ...input });
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId, followUpId } = target.data;
  const validatedInput = parsed.data;
  if (validatedInput.targetStatus === 'open' && !validatedInput.reason?.trim()) {
    return { success: false, error: 'reason_required' };
  }
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('transition_client_follow_up', {
    p_follow_up_id: followUpId,
    p_organization_id: auth.context.orgId,
    p_target_status: validatedInput.targetStatus,
    p_resolution_note: validatedInput.resolutionNote ?? '',
    p_actor_id: auth.context.userId,
    p_reason: validatedInput.reason ?? null,
  });
  const { error } = await auth.context.admin.rpc('transition_client_follow_up', args);
  if (error) {
    logError('Failed to transition customer follow-up:', error);
    return { success: false, error: 'transition_failed' };
  }
  return { success: true };
}

export async function saveCustomerCommunicationSettings(
  rawClientId: string,
  input: CommunicationSettingsInput,
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = communicationSettingsInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const validatedInput = parsed.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('save_client_communication_settings', {
    p_organization_id: auth.context.orgId,
    p_client_id: clientId,
    p_preferred_contact_id: validatedInput.preferredContactId ?? null,
    p_preferred_channel: validatedInput.preferredChannel ?? null,
    p_do_not_contact_instruction: validatedInput.doNotContactInstruction ?? '',
    p_contact_time_note: validatedInput.contactTimeNote ?? '',
    p_language_note: validatedInput.languageNote ?? '',
    p_accessibility_note: validatedInput.accessibilityNote ?? '',
    p_source_note: validatedInput.sourceNote ?? '',
    p_actor_id: auth.context.userId,
  });
  const { error } = await auth.context.admin.rpc('save_client_communication_settings', args);
  if (error) {
    logError('Failed to save communication settings:', error);
    return { success: false, error: 'save_failed' };
  }
  return { success: true };
}

export async function saveCustomerCommunicationPreference(
  rawClientId: string,
  input: CommunicationPreferenceInput,
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = communicationPreferenceInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const validatedInput = parsed.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('set_client_communication_preference', {
    p_organization_id: auth.context.orgId,
    p_client_id: clientId,
    p_contact_id: validatedInput.contactId ?? null,
    p_channel: validatedInput.channel,
    p_purpose: validatedInput.purpose,
    p_state: validatedInput.state,
    p_source_note: validatedInput.sourceNote ?? '',
    p_actor_id: auth.context.userId,
  });
  const { error } = await auth.context.admin.rpc('set_client_communication_preference', args);
  if (error) {
    logError('Failed to save communication preference:', error);
    return { success: false, error: 'save_failed' };
  }
  return { success: true };
}

async function evaluateCommunicationGuidanceForContext(
  context: ClientManagerContext,
  clientId: string,
  input: {
    contactId: string | null;
    channel: CommunicationChannel;
    purpose: CommunicationPurpose;
  },
): Promise<RelationshipActionResult<ReturnType<typeof resolveCommunicationGuidance>>> {
  const configuration = await loadCommunicationConfiguration(context, clientId);
  if (!configuration.success) return configuration;
  return {
    success: true,
    data: resolveCommunicationGuidance({
      ...input,
      settings: configuration.settings,
      preferences: configuration.preferences,
    }),
  };
}

export async function evaluateCustomerCommunicationGuidance(
  rawClientId: string,
  input: {
    contactId: string | null;
    channel: CommunicationChannel;
    purpose: CommunicationPurpose;
  },
): Promise<RelationshipActionResult<ReturnType<typeof resolveCommunicationGuidance>>> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = communicationGuidanceInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  return evaluateCommunicationGuidanceForContext(auth.context, clientId, parsed.data);
}

export async function recordCustomerCommunicationException(
  rawClientId: string,
  input: {
    contactId: string | null;
    channel: CommunicationChannel;
    purpose: CommunicationPurpose;
    reason: string;
  },
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = communicationExceptionInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const guidanceResult = await evaluateCommunicationGuidanceForContext(auth.context, clientId, parsed.data);
  if (!guidanceResult.success) return guidanceResult;
  if (guidanceResult.data.warnings.length === 0) {
    return { success: false, error: 'exception_not_required' };
  }
  const args = rpcArgs('record_client_communication_exception', {
    p_organization_id: auth.context.orgId,
    p_client_id: clientId,
    p_contact_id: parsed.data.contactId,
    p_channel: parsed.data.channel,
    p_purpose: parsed.data.purpose,
    p_warnings: guidanceResult.data.warnings as Json,
    p_reason: parsed.data.reason,
    p_actor_id: auth.context.userId,
  });
  const { error } = await auth.context.admin.rpc('record_client_communication_exception', args);
  if (error) {
    logError('Failed to record communication exception:', error);
    return { success: false, error: 'save_failed' };
  }
  return { success: true };
}
