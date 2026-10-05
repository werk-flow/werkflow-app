'use client';

import { formatGermanDateTime as formatDateTime } from '@/lib/utils';
import { useState } from 'react';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { REQUEST_CATEGORY_LABELS, REQUEST_SOURCE_LABELS, type ClientRequest } from '@/lib/requests/types';
import type { Client } from '@/lib/jobs/types';
import type { OrganizationDocument } from '@/lib/documents/types';
import { RequestStatusBadge, RequestUrgencyBadge } from './request-badges';
import { CloseRequestDialog } from './close-request-dialog';
import { ConvertRequestDialog } from './convert-request-dialog';
import { EditRequestDialog } from './edit-request-dialog';
import { RequestCustomerCard } from './request-customer-card';
import { RequestFactsCard } from './request-facts-card';
import { RequestHeaderActions } from './request-header-actions';
import { RequestHistoryCard } from './request-history-card';
import { RequestMatchFields } from './request-match-fields';
import { RequestOutcomeNotices } from './request-outcome-notices';
import { useRequestDetailActions } from './use-request-detail-actions';

export type RequestEventEntry = {
  id: string;
  eventType: string;
  createdAt: string;
  actorName: string | null;
};

export type RequestDetailData = {
  request: ClientRequest;
  clientName: string | null;
  siteLabel: string | null;
  contactLabel: string | null;
  contactPhone: string | null;
  assigneeName: string | null;
  convertedLink: { label: string; href: string | null } | null;
  /** Null when the read failed, so the region shows the failure instead of "none". */
  documents: OrganizationDocument[] | null;
  /** Null when the read failed, so the region shows the failure instead of "none". */
  events: RequestEventEntry[] | null;
  clients: Client[];
  assignees: Array<{ userId: string; name: string }>;
};

export function RequestDetailContent({ data }: { data: RequestDetailData }) {
  const { request } = data;
  const actions = useRequestDetailActions(request);
  const { isPending, shownStatus, markSettling } = actions;
  const [convertOpen, setConvertOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useRealtimeRouterRefresh({
    tables: ['client_requests', 'documents', 'document_links'],
  });

  const isEditable = request.status === 'offen' || request.status === 'in_klaerung';

  return (
    <PageShell>
      <DetailPageHeader
        breadcrumbs={[
          { label: 'Anfragen', href: '/anfragen' },
          { label: request.requestNumber || 'Anfrage' },
        ]}
        title={request.summary}
        subtitle={`${REQUEST_CATEGORY_LABELS[request.category]} · ${REQUEST_SOURCE_LABELS[request.source]} · Eingegangen am ${formatDateTime(request.receivedAt)}`}
        badges={
          <>
            <RequestStatusBadge status={shownStatus} />
            <RequestUrgencyBadge urgency={request.urgency} />
          </>
        }
        actions={
          <RequestHeaderActions
            request={request}
            shownStatus={shownStatus}
            isEditable={isEditable}
            isPending={isPending}
            isSettling={actions.isSettling}
            onConvert={() => setConvertOpen(true)}
            onEdit={() => setEditOpen(true)}
            onStatusToggle={actions.handleStatusToggle}
            onClose={() => setCloseOpen(true)}
            onReopen={actions.handleReopen}
          />
        }
      />
      {actions.headerError ? (
        <ErrorText className="mx-4 mt-4 sm:mx-6">{actions.headerError}</ErrorText>
      ) : null}

      <PageBody maxWidth="content">
        <div className="space-y-4">
          <RequestOutcomeNotices request={request} convertedLink={data.convertedLink} />

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Customer / caller context */}
            <RequestCustomerCard
              request={request}
              data={data}
              isEditable={isEditable}
              isPending={isPending}
              promoteError={actions.promoteError}
              onMatch={() => actions.setMatchOpen(true)}
              onPromote={actions.handlePromote}
            />

            {/* Request facts */}
            <RequestFactsCard request={request} assigneeName={data.assigneeName} />
          </div>

          {data.documents ? (
            <ContextualDocumentsSection
              title="Dokumente & Bilder"
              description="Fotos, Nachrichten oder Unterlagen zur Anfrage. Bei einer Umwandlung werden sie automatisch mit dem Auftrag oder Projekt verknüpft."
              documents={data.documents}
              documentTarget={{ kind: 'request', requestId: request.id }}
              canUpload={isEditable}
              canManage
            />
          ) : (
            <RegionLoadError>Dokumente und Bilder konnten nicht geladen werden.</RegionLoadError>
          )}

          {/* History */}
          {data.events ? (
            <RequestHistoryCard events={data.events} />
          ) : (
            <RegionLoadError>Der Verlauf der Anfrage konnte nicht geladen werden.</RegionLoadError>
          )}
        </div>
      </PageBody>

      <ConvertRequestDialog
        request={request}
        clients={data.clients}
        open={convertOpen}
        onOpenChange={setConvertOpen}
        onSaved={markSettling}
      />

      <CloseRequestDialog
        requestId={request.id}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onSaved={markSettling}
      />

      <EditRequestDialog
        request={request}
        assignees={data.assignees}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={markSettling}
      />

      {/* Match an existing customer to an unknown-caller request */}
      <Dialog open={actions.matchOpen} onOpenChange={actions.handleMatchOpenChange} pending={isPending}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Kunden zuordnen</DialogTitle>
            <DialogDescription>
              Die erfassten Anruferdaten bleiben zur Nachvollziehbarkeit an der Anfrage erhalten.
            </DialogDescription>
          </DialogHeader>
          <RequestMatchFields
            clients={data.clients}
            matchClientId={actions.matchClientId}
            matchSiteId={actions.matchSiteId}
            matchContactId={actions.matchContactId}
            matchError={actions.matchError}
            matchClientError={actions.matchClientError}
            isPending={isPending}
            onClientChange={actions.selectMatchClient}
            onSiteChange={actions.setMatchSiteId}
            onContactChange={actions.setMatchContactId}
            onCancel={() => actions.setMatchOpen(false)}
            onConfirm={actions.handleMatchConfirm}
          />
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
