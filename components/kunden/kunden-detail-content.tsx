'use client';

import { MoreVertical, Trash2, Briefcase } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RegionLoadError } from '@/components/shared/region-load-error';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { MetadataSection } from '@/components/shared/metadata-section';
import { EmbeddedAuftraegeSection } from '@/components/shared/embedded-auftraege-section';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { ClientFinancePlaceholder } from '@/components/kunden/client-finance-placeholder';
import { buildClientMetadataFields } from '@/components/kunden/client-metadata-fields';
import { ClientRelationsSection } from '@/components/kunden/client-relations-section';
import { CustomerRelationshipWorkspace } from '@/components/kunden/customer-relationship-workspace';
import { DeleteClientDialog } from '@/components/kunden/delete-client-dialog';
import { useClientDeletion } from '@/components/kunden/use-client-deletion';
import { useCommunicationContactGuard } from '@/components/kunden/use-communication-contact-guard';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';

import type { ClientContact, ClientSite } from '@/lib/clients/types';
import { CLIENT_TYPE_LABELS, type Client, type Job, type ProjectWithDetails } from '@/lib/jobs/types';
import type { OrganizationDocument } from '@/lib/documents/types';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import type { CustomerRelationshipBundle } from '@/lib/customer-relationships/types';
import type { EquipmentListItem } from '@/lib/installed-equipment/types';
import { SectionTitle } from '@/components/shared/section-title';

/** Null for a failed read, so the region shows the failure instead of "none". */
interface KundenDetailContentProps {
  client: Client;
  relations: { contacts: ClientContact[]; sites: ClientSite[] } | null;
  documents: OrganizationDocument[] | null;
  linkedWork: {
    jobs: Job[];
    projects: ProjectWithDetails[];
    clientMap: Record<string, string>;
    jobAssignmentMap: Record<string, string[]>;
  } | null;
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
  visibleColumns: AuftraegeColumnId[];
  currentUserId: string;
  relationshipBundle: CustomerRelationshipBundle | null;
  equipment: EquipmentListItem[];
  equipmentLoadFailed: boolean;
}

export function KundenDetailContent({
  client,
  relations,
  documents,
  linkedWork,
  members,
  isAdminOrManager,
  visibleColumns,
  currentUserId,
  relationshipBundle,
  equipment,
  equipmentLoadFailed,
}: KundenDetailContentProps) {
  const { showDeleteDialog, setShowDeleteDialog, isDeleting, isDeletingRef, deleteError, handleDelete } =
    useClientDeletion(client);
  const contactGuard = useCommunicationContactGuard({
    clientId: client.id,
  });

  // Colleagues' contact/site/master-data changes appear without a reload.
  useRealtimeRouterRefresh({
    enabled: !isDeleting,
    tables: [
      'clients',
      'client_contacts',
      'client_sites',
      'client_requests',
      'client_follow_ups',
      'client_communication_settings',
      'client_communication_preferences',
      'jobs',
      'projects',
      'document_links',
      'installed_equipment',
    ],
    eventFilter: (event) => {
      if (isDeletingRef.current) return false;
      const row = event.new ?? event.old;
      if (!row) return false;
      if (event.table === 'clients') return row.id === client.id;
      if (row.client_id === undefined) return event.eventType === 'DELETE';
      return row.client_id === client.id;
    },
  });

  const metadataFields = buildClientMetadataFields(client);

  const breadcrumbs = [{ label: 'Kunden', href: '/kunden' }, { label: client.name }];

  return (
    <PageShell>
      <DetailPageHeader
        breadcrumbs={breadcrumbs}
        title={client.name}
        subtitle={client.email ?? undefined}
        badges={
          <Badge variant="secondary" className="text-xs">
            {CLIENT_TYPE_LABELS[client.clientType]}
          </Badge>
        }
        actions={
          isAdminOrManager ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label="Aktionen öffnen">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="size-4" />
                  Kunde löschen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />

      <PageBody>
        {/* Columns follow the width of this content, not of the screen: the app sidebar takes
            256 px, so a screen breakpoint turned the columns on where they did not fit. */}
        <div className="@container/detail">
          <div className="grid grid-cols-1 gap-6 @7xl/detail:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            {/* Left Column: Metadata + Financial Placeholders */}
            <div className="grid grid-cols-1 gap-6 @3xl/detail:grid-cols-2 @7xl/detail:grid-cols-1">
              <MetadataSection title="Kundendetails" fields={metadataFields} isEditable={isAdminOrManager} />

              {relations ? (
                <ClientRelationsSection
                  clientId={client.id}
                  clientAddress={client.address}
                  contacts={relations.contacts}
                  sites={relations.sites}
                  isAdminOrManager={isAdminOrManager}
                  onRequestContact={contactGuard.requestContact}
                  isCheckingContact={contactGuard.isCheckingContact}
                  equipment={equipment}
                  equipmentLoadFailed={equipmentLoadFailed}
                />
              ) : (
                <RegionLoadError>
                  Ansprechpartner und Einsatzorte konnten nicht geladen werden.
                </RegionLoadError>
              )}

              {/* Financial Summary Placeholder */}
              <div className="space-y-3">
                <ClientFinancePlaceholder />

                {documents ? (
                  <ContextualDocumentsSection
                    title="Dokumente"
                    description="Verträge, Angebote, Rechnungen und weitere Kundendokumente."
                    documents={documents}
                    documentTarget={{ kind: 'client', clientId: client.id }}
                    contextLabel={client.name}
                    canUpload={isAdminOrManager}
                    canManage={isAdminOrManager}
                  />
                ) : (
                  <RegionLoadError>Die Kundendokumente konnten nicht geladen werden.</RegionLoadError>
                )}
              </div>
            </div>

            {/* Right Column: relationship priorities, history, and linked work */}
            <div className="min-w-0 space-y-8">
              {relationshipBundle ? (
                <CustomerRelationshipWorkspace
                  clientId={client.id}
                  currentUserId={currentUserId}
                  contacts={relations?.contacts ?? []}
                  initialBundle={relationshipBundle}
                />
              ) : (
                <RegionLoadError>
                  Kundenhistorie, Nachfassaktionen und Kontaktvorgaben konnten nicht geladen werden.
                </RegionLoadError>
              )}

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="size-4 text-muted-foreground" />
                  <SectionTitle>Zugeordnete Aufträge & Projekte</SectionTitle>
                </div>
                {linkedWork ? (
                  <EmbeddedAuftraegeSection
                    jobs={linkedWork.jobs}
                    projects={linkedWork.projects}
                    clientMap={linkedWork.clientMap}
                    jobAssignmentMap={linkedWork.jobAssignmentMap}
                    members={members}
                    lockedClientLabel={client.name}
                    hideClientColumn
                    defaultClient={client}
                    readOnlyClient
                    isAdminOrManager={isAdminOrManager}
                    visibleColumns={visibleColumns}
                    emptyTitle="Keine Aufträge"
                    emptyDescription="Diesem Kunden sind derzeit keine Aufträge oder Projekte zugeordnet."
                  />
                ) : (
                  <RegionLoadError>
                    Die Aufträge und Projekte dieses Kunden konnten nicht geladen werden.
                  </RegionLoadError>
                )}
              </div>
            </div>
          </div>
        </div>
      </PageBody>

      {contactGuard.dialog}

      {/* Delete Dialog */}
      <DeleteClientDialog
        clientName={client.name}
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        isDeleting={isDeleting}
        deleteError={deleteError}
        onConfirm={handleDelete}
      />
    </PageShell>
  );
}
