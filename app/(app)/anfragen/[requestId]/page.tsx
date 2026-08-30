import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { toClient } from '@/lib/jobs/types';
import { formatSiteAddress } from '@/lib/clients/types';
import { toClientRequest, toClientRequestEvent } from '@/lib/requests/types';
import { getRequestDocuments } from '@/lib/documents/actions';
import {
  RequestDetailContent,
  type RequestDetailData,
  type RequestEventEntry,
} from '@/components/anfragen/request-detail-content';
import type { OrgRole } from '@/lib/members/actions';
import {
  formatProfileName,
  getManagerAssigneeOptions,
} from '@/lib/members/profile-name';

export default async function AnfrageDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;

  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ]);

  if (!activeOrgId) {
    redirect('/anfragen');
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  const admin = createSupabaseAdminClient();

  const { data: requestRow, error: requestError } = await admin
    .from('client_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', activeOrgId)
    .maybeSingle();

  if (requestError || !requestRow) {
    notFound();
  }

  const request = toClientRequest(requestRow);

  const [
    clientResult,
    siteResult,
    contactResult,
    assigneeResult,
    convertedJobResult,
    convertedProjectResult,
    eventsResult,
    clientsResult,
    assignees,
    documentsResult,
    convertedServiceCaseResult,
  ] = await Promise.all([
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
    admin
      .from('client_request_events')
      .select('*')
      .eq('request_id', requestId)
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false }),
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    getManagerAssigneeOptions(admin, activeOrgId),
    getRequestDocuments(requestId),
    admin
      .from('service_cases')
      .select('id, case_number, summary')
      .eq('organization_id', activeOrgId)
      .eq('source_request_id', requestId)
      .maybeSingle(),
  ]);

  const events = (eventsResult.data ?? []).map(toClientRequestEvent);
  const actorIds = Array.from(
    new Set(events.map((event) => event.createdBy).filter((id): id is string => Boolean(id)))
  );
  const { data: actorProfiles } = actorIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', actorIds)
    : { data: [] };
  const actorById = new Map(
    (actorProfiles ?? []).map((profile) => [profile.id, profile])
  );

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
  const convertedJob = convertedJobResult.data;
  const convertedProject = convertedProjectResult.data;
  const convertedServiceCase = convertedServiceCaseResult.data;

  const data: RequestDetailData = {
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
      ? [contact.name, contact.role ? `(${contact.role})` : null]
          .filter(Boolean)
          .join(' ')
      : null,
    contactPhone: contact?.phone ?? null,
    assigneeName: assigneeResult.data
      ? formatProfileName(assigneeResult.data)
      : null,
    // Detail routes are keyed by number; without one, show plain text instead
    // of a broken link.
    convertedLink: convertedJob
      ? {
          label: `Auftrag ${convertedJob.job_number ?? convertedJob.title}`,
          href: convertedJob.job_number
            ? `/auftraege/${encodeURIComponent(convertedJob.job_number)}`
            : null,
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
          : null,
    documents: documentsResult.success ? documentsResult.documents : [],
    events: eventEntries,
    clients: (clientsResult.data ?? []).map(toClient),
    assignees,
  };

  return (
    <div className="flex h-full flex-col overflow-auto p-4 sm:p-6">
      <RequestDetailContent data={data} />
    </div>
  );
}
