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
import { DetailColumns } from '@/components/shared/detail-columns';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { MetadataSection, type MetadataField } from '@/components/shared/metadata-section';
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

  useKundenDetailRealtime(client.id, isDeleting, isDeletingRef);

  const metadataFields = buildClientMetadataFields(client);

  return (
    <PageShell>
      <KundenDetailHeader
        client={client}
        isAdminOrManager={isAdminOrManager}
        onDelete={() => setShowDeleteDialog(true)}
      />

      <PageBody>
        <DetailColumns layout="cards-and-table">
          {/* Left Column: Metadata + Financial Placeholders */}
          <KundenDetailOverviewColumn
            client={client}
            relations={relations}
            documents={documents}
            isAdminOrManager={isAdminOrManager}
            equipment={equipment}
            equipmentLoadFailed={equipmentLoadFailed}
            metadataFields={metadataFields}
            contactGuard={contactGuard}
          />

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

            <KundenLinkedWorkSection
              client={client}
              linkedWork={linkedWork}
              members={members}
              isAdminOrManager={isAdminOrManager}
              visibleColumns={visibleColumns}
            />
          </div>
        </DetailColumns>
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

/** Left column: master data, contacts and sites, finance placeholder and documents. */
function KundenDetailOverviewColumn({
  client,
  relations,
  documents,
  isAdminOrManager,
  equipment,
  equipmentLoadFailed,
  metadataFields,
  contactGuard,
}: Pick<
  KundenDetailContentProps,
  'client' | 'relations' | 'documents' | 'isAdminOrManager' | 'equipment' | 'equipmentLoadFailed'
> & {
  metadataFields: MetadataField[];
  contactGuard: Pick<ReturnType<typeof useCommunicationContactGuard>, 'requestContact' | 'isCheckingContact'>;
}) {
  return (
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
        <RegionLoadError>Ansprechpartner und Einsatzorte konnten nicht geladen werden.</RegionLoadError>
      )}

      {/* Financial Summary Placeholder */}
      <KundenDocumentsColumn client={client} documents={documents} isAdminOrManager={isAdminOrManager} />
    </div>
  );
}

/** Colleagues' contact/site/master-data changes appear without a reload. */
function useKundenDetailRealtime(
  clientId: string,
  isDeleting: boolean,
  isDeletingRef: React.RefObject<boolean>,
): void {
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
      if (event.table === 'clients') return row.id === clientId;
      if (row.client_id === undefined) return event.eventType === 'DELETE';
      return row.client_id === clientId;
    },
  });
}

function KundenDetailHeader({
  client,
  isAdminOrManager,
  onDelete,
}: Pick<KundenDetailContentProps, 'client' | 'isAdminOrManager'> & { onDelete: () => void }) {
  const breadcrumbs = [{ label: 'Kunden', href: '/kunden' }, { label: client.name }];

  return (
    <DetailPageHeader
      breadcrumbs={breadcrumbs}
      title={client.name}
      subtitle={client.email ?? undefined}
      badges={
        <Badge variant="secondary" className="text-xs">
          {CLIENT_TYPE_LABELS[client.clientType]}
        </Badge>
      }
      actions={isAdminOrManager ? <KundenDetailActionsMenu onDelete={onDelete} /> : undefined}
    />
  );
}

function KundenDetailActionsMenu({ onDelete }: { onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="size-8" aria-label="Aktionen öffnen">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Kunde löschen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The finance placeholder and the customer's documents. */
function KundenDocumentsColumn({
  client,
  documents,
  isAdminOrManager,
}: Pick<KundenDetailContentProps, 'client' | 'documents' | 'isAdminOrManager'>) {
  return (
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
  );
}

/** The jobs and projects linked to the customer. */
function KundenLinkedWorkSection({
  client,
  linkedWork,
  members,
  isAdminOrManager,
  visibleColumns,
}: Pick<
  KundenDetailContentProps,
  'client' | 'linkedWork' | 'members' | 'isAdminOrManager' | 'visibleColumns'
>) {
  return (
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
  );
}
