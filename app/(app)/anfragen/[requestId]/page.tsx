import { notFound, redirect } from 'next/navigation';

import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';
import { formatSiteAddress } from '@/lib/clients/types';
import {
  toClientRequest,
  toClientRequestEvent,
  type ClientRequest,
  type ClientRequestEvent,
} from '@/lib/requests/types';
import { getRequestDocuments } from '@/lib/documents/actions';
import {
  RequestDetailContent,
  type RequestDetailData,
  type RequestEventEntry,
} from '@/components/anfragen/request-detail-content';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { formatProfileName, getManagerAssigneeOptions } from '@/lib/members/profile-name';

/** The reads that need a value from the request row, and the event actors. */
function readLabelWave(admin: AdminClient, activeOrgId: string, request: ClientRequest, actorIds: string[]) {
  return Promise.all([
    request.clientId
      ? admin
          .from('clients')
          .select('id, name')
          .eq('id', request.clientId)
          .eq('organization_id', activeOrgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    request.siteId
      ? admin
          .from('client_sites')
          .select('*')
          .eq('id', request.siteId)
          .eq('organization_id', activeOrgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    request.contactId
      ? admin
          .from('client_contacts')
          .select('*')
          .eq('id', request.contactId)
          .eq('organization_id', activeOrgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    request.assignedTo
      ? admin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .eq('id', request.assignedTo)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    request.convertedJobId
      ? admin
          .from('jobs')
          .select('id, title, job_number')
          .eq('id', request.convertedJobId)
          .eq('organization_id', activeOrgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    request.convertedProjectId
      ? admin
          .from('projects')
          .select('id, name, project_number')
          .eq('id', request.convertedProjectId)
          .eq('organization_id', activeOrgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // One request has a handful of events, so the actor list is small.
    readInBatches(actorIds, (batch) =>
      admin.from('profiles').select('id, first_name, last_name, email').in('id', batch),
    ),
  ]);
}

type LabelWave = Awaited<ReturnType<typeof readLabelWave>>;

/**
 * A failed label read would show a missing customer, site, contact, assignee
 * or conversion as if there were none, so it fails the page instead.
 */
function anyLabelReadFailed(labelWave: LabelWave, convertedServiceCaseResult: object): boolean {
  const [
    clientResult,
    siteResult,
    contactResult,
    assigneeResult,
    convertedJobResult,
    convertedProjectResult,
  ] = labelWave;
  const results: ReadonlyArray<object> = [
    clientResult,
    siteResult,
    contactResult,
    assigneeResult,
    convertedJobResult,
    convertedProjectResult,
    convertedServiceCaseResult,
  ];
  return results.some((result) => 'error' in result && Boolean(result.error));
}

/** Detail routes are keyed by number; without one, show plain text instead of a broken link. */
function convertedLinkOf(
  convertedJob: LabelWave[4]['data'],
  convertedProject: LabelWave[5]['data'],
  convertedServiceCase: { case_number: string } | null,
): RequestDetailData['convertedLink'] {
  return convertedJob
    ? {
        label: `Auftrag ${convertedJob.job_number ?? convertedJob.title}`,
        href: convertedJob.job_number ? `/auftraege/${encodeURIComponent(convertedJob.job_number)}` : null,
      }
    : convertedProject
      ? {
          label: `Projekt ${convertedProject.project_number ?? convertedProject.name}`,
          href: convertedProject.project_number
            ? `/auftraege/projekt/${encodeURIComponent(convertedProject.project_number)}`
            : null,
        }
      : convertedServiceCase
        ? {
            label: `Servicefall ${convertedServiceCase.case_number}`,
            href: `/service/faelle/${encodeURIComponent(convertedServiceCase.case_number)}`,
          }
        : null;
}

/** The page's props from both waves; the events are null when their read or the actor read failed. */
function requestDetailData({
  request,
  events,
  eventsFailed,
  assignees,
  documents,
  convertedServiceCase,
  labelWave: [
    clientResult,
    siteResult,
    contactResult,
    assigneeResult,
    convertedJobResult,
    convertedProjectResult,
    actorsResult,
  ],
}: {
  request: ClientRequest;
  events: ClientRequestEvent[];
  eventsFailed: boolean;
  assignees: RequestDetailData['assignees'];
  documents: RequestDetailData['documents'];
  convertedServiceCase: { case_number: string } | null;
  labelWave: LabelWave;
}): RequestDetailData {
  const actorById = new Map((actorsResult.data ?? []).map((profile) => [profile.id, profile]));

  const eventEntries: RequestEventEntry[] = events.map((event) => {
    const actor = event.createdBy ? actorById.get(event.createdBy) : null;
    return {
      id: event.id,
      eventType: event.eventType,
      createdAt: event.createdAt,
      actorName: actor ? formatProfileName(actor) : null,
    };
  });

  const site = siteResult.data;
  const contact = contactResult.data;

  return {
    request,
    clientName: clientResult.data?.name ?? null,
    siteLabel: site
      ? [
          site.name,
          formatSiteAddress({
            street: site.street,
            postalCode: site.postal_code,
            city: site.city,
          }),
        ]
          .filter(Boolean)
          .join(' · ')
      : null,
    contactLabel: contact
      ? [contact.name, contact.role ? `(${contact.role})` : null].filter(Boolean).join(' ')
      : null,
    contactPhone: contact?.phone ?? null,
    assigneeName: assigneeResult.data ? formatProfileName(assigneeResult.data) : null,
    convertedLink: convertedLinkOf(
      convertedJobResult.data,
      convertedProjectResult.data,
      convertedServiceCase,
    ),
    documents,
    events: eventsFailed || actorsResult.error ? null : eventEntries,
    assignees,
  };
}

export default async function AnfrageDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;

  const { membership } = await resolvePageMembership();

  if (!membership) {
    redirect('/anfragen');
  }

  const activeOrgId = membership.orgId;
  if (!isManagerRole(membership.role)) {
    redirect('/dashboard');
  }

  const admin = createSupabaseAdminClient();

  // Two waves instead of three: everything keyed by the request id and the
  // authorized organization starts with the request row; the reads that need a
  // value from that row, and the event actors, follow together.
  const [
    { data: requestRow, error: requestError },
    eventsResult,
    assignees,
    documentsResult,
    convertedServiceCaseResult,
  ] = await Promise.all([
    admin
      .from('client_requests')
      .select('*')
      .eq('id', requestId)
      .eq('organization_id', activeOrgId)
      .maybeSingle(),
    admin
      .from('client_request_events')
      .select('*')
      .eq('request_id', requestId)
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false }),
    getManagerAssigneeOptions(admin, activeOrgId),
    getRequestDocuments(requestId),
    admin
      .from('service_cases')
      .select('id, case_number, summary')
      .eq('organization_id', activeOrgId)
      .eq('source_request_id', requestId)
      .maybeSingle(),
  ]);

  if (requestError) {
    return (
      <RegionLoadError title="Die Anfrage konnte nicht geladen werden">
        Die Anfrage ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  if (!requestRow) notFound();

  const request = toClientRequest(requestRow);
  const events = (eventsResult.data ?? []).map(toClientRequestEvent);
  const actorIds = Array.from(
    new Set(events.map((event) => event.createdBy).filter((id): id is string => Boolean(id))),
  );

  const labelWave = await readLabelWave(admin, activeOrgId, request, actorIds);
  if (!assignees.success || anyLabelReadFailed(labelWave, convertedServiceCaseResult)) {
    return (
      <RegionLoadError title="Die Anfrage konnte nicht geladen werden">
        Kunde, Einsatzort, Ansprechpartner, Zuständige oder Umwandlung sind gerade nicht erreichbar. Versuche
        es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  return (
    <RequestDetailContent
      data={requestDetailData({
        request,
        events,
        eventsFailed: Boolean(eventsResult.error),
        assignees: assignees.options,
        documents: documentsResult.success ? documentsResult.documents : null,
        convertedServiceCase: convertedServiceCaseResult.data,
        labelWave,
      })}
    />
  );
}
