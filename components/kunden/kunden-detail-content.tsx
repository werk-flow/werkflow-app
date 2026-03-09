'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreVertical,
  Trash2,
  Loader2,
  Briefcase,
  Receipt,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import {
  MetadataSection,
  type MetadataField,
} from '@/components/shared/metadata-section';
import { PlaceholderSection } from '@/components/shared/placeholder-section';
import { EmbeddedAuftraegeSection } from '@/components/shared/embedded-auftraege-section';

import { updateClient, deleteClient } from '@/lib/clients/actions';
import {
  CLIENT_TYPE_LABELS,
  type Client,
  type ClientType,
  type Job,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

interface KundenDetailContentProps {
  client: Client;
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
  clients: Client[];
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
}

export function KundenDetailContent({
  client,
  jobs,
  projects,
  clientMap,
  jobAssignmentMap,
  clients,
  members,
  isAdminOrManager,
}: KundenDetailContentProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteClient(client.id);
    if (result.success) {
      router.push('/kunden');
      router.refresh();
    } else {
      setDeleteError(result.error || 'Fehler beim Löschen des Kunden');
      setIsDeleting(false);
    }
  };

  const clientTypeOptions: { value: string; label: string }[] = [
    { value: 'privat', label: CLIENT_TYPE_LABELS.privat },
    { value: 'geschaeftlich', label: CLIENT_TYPE_LABELS.geschaeftlich },
  ];

  const metadataFields: MetadataField[] = [
    {
      label: 'Name',
      value: client.name,
      editableConfig: {
        type: 'text',
        currentValue: client.name,
        onSave: async (v) => {
          await updateClient(client.id, { name: v });
        },
      },
    },
    {
      label: 'Typ',
      value: (
        <Badge variant="secondary" className="text-xs">
          {CLIENT_TYPE_LABELS[client.clientType]}
        </Badge>
      ),
      editableConfig: {
        type: 'select',
        currentValue: client.clientType,
        onSave: async (v) => {
          await updateClient(client.id, { clientType: v as ClientType });
        },
        options: clientTypeOptions,
      },
    },
    {
      label: 'E-Mail',
      value: client.email || '—',
      editableConfig: {
        type: 'text',
        currentValue: client.email ?? '',
        onSave: async (v) => {
          await updateClient(client.id, { email: v });
        },
        placeholder: 'E-Mail-Adresse',
      },
    },
    {
      label: 'Telefon',
      value: client.phone || '—',
      editableConfig: {
        type: 'text',
        currentValue: client.phone ?? '',
        onSave: async (v) => {
          await updateClient(client.id, { phone: v });
        },
        placeholder: 'Telefonnummer',
      },
    },
    {
      label: 'Adresse',
      value: client.address || '—',
      editableConfig: {
        type: 'textarea',
        currentValue: client.address ?? '',
        onSave: async (v) => {
          await updateClient(client.id, { address: v });
        },
        placeholder: 'Straße, PLZ, Ort',
      },
    },
    {
      label: 'Notizen',
      value: client.notes || '—',
      editableConfig: {
        type: 'textarea',
        currentValue: client.notes ?? '',
        onSave: async (v) => {
          await updateClient(client.id, { notes: v });
        },
        placeholder: 'Interne Notizen',
      },
    },
    {
      label: 'Erstellt am',
      value: formatDate(client.createdAt),
    },
  ];

  const breadcrumbs = [
    { label: 'Kunden', href: '/kunden' },
    { label: client.name },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
                <Button variant="outline" size="icon" className="size-8">
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

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
          {/* Left Column: Metadata + Financial Placeholders */}
          <div className="space-y-6">
            <MetadataSection
              title="Kundendetails"
              fields={metadataFields}
              isEditable={isAdminOrManager}
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

              <PlaceholderSection
                title="Dokumente"
                description="Verträge, Angebote und andere Dokumente werden hier in einer zukünftigen Version angezeigt."
                icon={<Receipt className="size-8" />}
              />
            </div>
          </div>

          {/* Right Column: Associated Jobs & Projects */}
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
              isAdminOrManager={isAdminOrManager}
              emptyTitle="Keine Aufträge"
              emptyDescription="Diesem Kunden sind derzeit keine Aufträge oder Projekte zugeordnet."
            />
          </div>
        </div>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kunde löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du{' '}
              <span className="font-medium">{client.name}</span> löschen
              möchtest? Bestehende Aufträge und Projekte verlieren die Zuordnung
              zu diesem Kunden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird gelöscht...
                </>
              ) : (
                'Löschen'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
