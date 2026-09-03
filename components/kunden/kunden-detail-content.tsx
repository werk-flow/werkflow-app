"use client";

import { useRef, useState } from "react";
import {
  MoreVertical,
  Trash2,
  Loader2,
  Briefcase,
  Receipt,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErrorText } from "@/components/ui/error-text";
import { SectionError } from "@/components/ui/section-error";

import { DetailPageHeader } from "@/components/shared/detail-page-header";
import { PageBody, PageShell } from "@/components/shared/page-shell";
import {
  MetadataSection,
  MetadataSaveError,
  type MetadataField,
} from "@/components/shared/metadata-section";
import { EmbeddedAuftraegeSection } from "@/components/shared/embedded-auftraege-section";
import { ContextualDocumentsSection } from "@/components/dokumente/contextual-documents-section";
import { ClientRelationsSection } from "@/components/kunden/client-relations-section";
import { CustomerRelationshipWorkspace } from "@/components/kunden/customer-relationship-workspace";
import { useCommunicationContactGuard } from "@/components/kunden/use-communication-contact-guard";
import { useRealtimeRouterRefresh } from "@/hooks/use-realtime-router-refresh";

import { updateClient, deleteClient } from "@/lib/clients/actions";
import type { ClientContact, ClientSite } from "@/lib/clients/types";
import {
  CLIENT_TYPE_LABELS,
  type Client,
  type ClientType,
  type Job,
  type ProjectWithDetails,
} from "@/lib/jobs/types";
import type { OrganizationDocument } from "@/lib/documents/types";
import type { AuftraegeColumnId } from "@/lib/jobs/auftraege-table-columns";
import type { OrgMemberOption } from "@/components/auftraege/employee-multi-select";
import type { CustomerRelationshipBundle } from "@/lib/customer-relationships/types";
import type { EquipmentListItem } from "@/lib/installed-equipment/types";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

interface KundenDetailContentProps {
  client: Client;
  contacts: ClientContact[];
  sites: ClientSite[];
  documents: OrganizationDocument[];
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
  clients: Client[];
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
  contacts,
  sites,
  documents,
  jobs,
  projects,
  clientMap,
  jobAssignmentMap,
  clients,
  members,
  isAdminOrManager,
  visibleColumns,
  currentUserId,
  relationshipBundle,
  equipment,
  equipmentLoadFailed,
}: KundenDetailContentProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isDeletingRef = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const contactGuard = useCommunicationContactGuard({
    clientId: client.id,
  });

  // Colleagues' contact/site/master-data changes appear without a reload.
  useRealtimeRouterRefresh({
    enabled: !isDeleting,
    tables: [
      "clients",
      "client_contacts",
      "client_sites",
      "client_requests",
      "client_follow_ups",
      "client_communication_settings",
      "client_communication_preferences",
      "jobs",
      "projects",
      "document_links",
      "installed_equipment",
    ],
    eventFilter: (event) => {
      if (isDeletingRef.current) return false;
      const row = event.new ?? event.old;
      if (!row) return false;
      if (event.table === "clients") return row.id === client.id;
      if (row.client_id === undefined) return event.eventType === "DELETE";
      return row.client_id === client.id;
    },
  });

  const handleDelete = async () => {
    if (isDeleting) return;
    isDeletingRef.current = true;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteClient(client.id);
      if (result.success) {
        // Hard navigation: the soft router.push after this server action
        // intermittently never commits (deletion-stall defect, evidenced
        // 2026-08-21 — DELETE 204 while the URL never changed). Leaving a
        // permanently deleted record's page loses no state worth keeping.
        window.location.assign(
          `/kunden?deleted_client=${encodeURIComponent(client.name)}`,
        );
        return;
      }

      isDeletingRef.current = false;
      setDeleteError(result.error || "Fehler beim Löschen des Kunden");
      setIsDeleting(false);
    } catch {
      isDeletingRef.current = false;
      setIsDeleting(false);
      setDeleteError("Fehler beim Löschen des Kunden");
    }
  };

  const clientTypeOptions: { value: string; label: string }[] = [
    { value: "privat", label: CLIENT_TYPE_LABELS.privat },
    { value: "gewerblich", label: CLIENT_TYPE_LABELS.gewerblich },
  ];

  const metadataFields: MetadataField[] = [
    {
      label: "Name",
      value: client.name,
      editableConfig: {
        type: "text",
        currentValue: client.name,
        onSave: async (v) => {
          await updateClient(client.id, { name: v });
        },
      },
    },
    {
      label: "Typ",
      value: (
        <Badge variant="secondary" className="text-xs">
          {CLIENT_TYPE_LABELS[client.clientType]}
        </Badge>
      ),
      editableConfig: {
        type: "select",
        currentValue: client.clientType,
        onSave: async (v) => {
          await updateClient(client.id, { clientType: v as ClientType });
        },
        options: clientTypeOptions,
      },
    },
    {
      label: "Kundennummer",
      value: client.customerNumber || "—",
      editableConfig: {
        type: "text",
        currentValue: client.customerNumber ?? "",
        onSave: async (v) => {
          const result = await updateClient(client.id, { customerNumber: v });
          if (!result.success) {
            throw new MetadataSaveError(
              result.error === "customer_number_taken"
                ? "Diese Kundennummer ist bereits vergeben."
                : "Kundennummer konnte nicht gespeichert werden.",
            );
          }
        },
        placeholder: "z. B. K-1001",
      },
    },
    {
      label: "E-Mail",
      value: client.email || "—",
      editableConfig: {
        type: "text",
        currentValue: client.email ?? "",
        onSave: async (v) => {
          await updateClient(client.id, { email: v });
        },
        placeholder: "E-Mail-Adresse",
      },
    },
    {
      label: "Telefon",
      value: client.phone || "—",
      editableConfig: {
        type: "text",
        currentValue: client.phone ?? "",
        onSave: async (v) => {
          await updateClient(client.id, { phone: v });
        },
        placeholder: "Telefonnummer",
      },
    },
    {
      label: "Adresse",
      value: client.address || "—",
      editableConfig: {
        type: "textarea",
        currentValue: client.address ?? "",
        onSave: async (v) => {
          await updateClient(client.id, { address: v });
        },
        placeholder: "Straße, PLZ, Ort",
      },
    },
    {
      label: "Notizen",
      value: client.notes || "—",
      editableConfig: {
        type: "textarea",
        currentValue: client.notes ?? "",
        onSave: async (v) => {
          await updateClient(client.id, { notes: v });
        },
        placeholder: "Interne Notizen",
      },
    },
    {
      label: "Erstellt am",
      value: formatDate(client.createdAt),
    },
  ];

  const breadcrumbs = [
    { label: "Kunden", href: "/kunden" },
    { label: client.name },
  ];

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
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="Aktionen öffnen"
                >
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
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_1.5fr]">
          {/* Left Column: Metadata + Financial Placeholders */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-1">
            <MetadataSection
              title="Kundendetails"
              fields={metadataFields}
              isEditable={isAdminOrManager}
            />

            <ClientRelationsSection
              clientId={client.id}
              clientAddress={client.address}
              contacts={contacts}
              sites={sites}
              isAdminOrManager={isAdminOrManager}
              onRequestContact={contactGuard.requestContact}
              equipment={equipment}
              equipmentLoadFailed={equipmentLoadFailed}
            />

            {/* Financial Summary Placeholder */}
            <div className="space-y-3">
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Receipt className="size-4" />
                  Finanzen
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      Offene Rechnungen
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-muted-foreground/50">
                      —
                    </p>
                  </div>
                  <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      Gesamtumsatz
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-muted-foreground/50">
                      —
                    </p>
                  </div>
                  <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      Bezahlte Rechnungen
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-muted-foreground/50">
                      —
                    </p>
                  </div>
                  <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      Offene Beträge
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-muted-foreground/50">
                      —
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground/60">
                  Finanzübersicht wird verfügbar, sobald Rechnungen und Verträge
                  eingerichtet sind.
                </p>
              </div>

              <ContextualDocumentsSection
                title="Dokumente"
                description="Verträge, Angebote, Rechnungen und weitere Kundendokumente."
                documents={documents}
                documentTarget={{ kind: "client", clientId: client.id }}
                contextLabel={client.name}
                canUpload={isAdminOrManager}
                canManage={isAdminOrManager}
              />
            </div>
          </div>

          {/* Right Column: relationship priorities, history, and linked work */}
          <div className="space-y-8 md:col-span-2 2xl:col-span-1">
            {relationshipBundle ? (
              <CustomerRelationshipWorkspace
                clientId={client.id}
                currentUserId={currentUserId}
                contacts={contacts}
                initialBundle={relationshipBundle}
              />
            ) : (
              <SectionError>
                Kundenhistorie, Nachfassaktionen und Kontaktvorgaben konnten
                nicht geladen werden.
              </SectionError>
            )}

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Briefcase className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Zugeordnete Aufträge & Projekte
                </h3>
              </div>
              <EmbeddedAuftraegeSection
                jobs={jobs}
                projects={projects}
                clientMap={clientMap}
                jobAssignmentMap={jobAssignmentMap}
                clients={clients}
                members={members}
                lockedClientLabel={client.name}
                hideClientColumn
                defaultClientId={client.id}
                readOnlyClient
                isAdminOrManager={isAdminOrManager}
                visibleColumns={visibleColumns}
                emptyTitle="Keine Aufträge"
                emptyDescription="Diesem Kunden sind derzeit keine Aufträge oder Projekte zugeordnet."
              />
            </div>
          </div>
        </div>
      </PageBody>

      {contactGuard.dialog}

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kunde löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du{" "}
              <span className="font-medium">{client.name}</span> löschen
              möchtest? Bestehende Aufträge und Projekte verlieren die Zuordnung
              zu diesem Kunden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorText>{deleteError}</ErrorText>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird gelöscht...
                </>
              ) : (
                "Löschen"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
