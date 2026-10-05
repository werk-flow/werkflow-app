'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';

import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { useOrganization } from '@/components/organization/organization-context';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { Button } from '@/components/ui/button';
import { SectionError } from '@/components/ui/section-error';
import { InlinePending } from '@/components/ui/inline-pending';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import type { OrganizationDocument } from '@/lib/documents/types';
import {
  SERVICE_CASE_STATUS_LABELS,
  SERVICE_CASE_URGENCY_LABELS,
  type ServiceCaseDetailWorkspace,
} from '@/lib/service-cases/types';
import { FollowUpDialog, RelationDialog } from './service-case-detail-dialogs';
import {
  ServiceCaseDetailSidebar,
  ServiceCaseHistorySection,
  ServiceCaseOriginSection,
  ServiceCaseRelationsSection,
  ServiceCaseTriageSection,
} from './service-case-detail-sections';
import { ServiceCaseEvidenceLink } from './service-case-evidence-link';
import { ServiceCaseFormDialog } from './service-case-form-dialog';
import { formatGermanMediumDateTime } from '@/lib/utils';

export function ServiceCaseDetailContent({
  initial,
  documents,
  documentsLoadFailed,
}: {
  initial: ServiceCaseDetailWorkspace;
  documents: OrganizationDocument[];
  documentsLoadFailed: boolean;
}): ReactElement {
  const [editOpen, setEditOpen] = useState(false);
  const [relationOpen, setRelationOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const { activeOrgId } = useOrganization();
  // Reads over GET, outside the Server Action queue the dialogs' saves use.
  const live = useLiveView({
    tables: ['service_cases'],
    initialData: initial,
    resetKey: initial.serviceCase.id,
    eventFilter: (event) => {
      const row = event.new ?? event.old;
      return !row?.id || row.id === initial.serviceCase.id;
    },
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: false as const };
      const result = await readInBackground(
        'service-case-detail',
        { organizationId: activeOrgId, caseNumber: initial.serviceCase.caseNumber },
        signal,
      );
      return result.success
        ? { ok: true as const, data: result.workspace }
        : { ok: false as const, error: result.error };
    },
  });
  const workspace = live.data ?? initial;
  const item = workspace.serviceCase;
  // Section-scoped settle window after a dialog action: the touched section
  // shows the indicator until the live read lands.
  const settling = useBusyIds<'case' | 'relations'>();
  const settleOn = (section: 'case' | 'relations') => () => void settling.run(section, live.refresh);
  return (
    <div className="space-y-6">
      {live.isStale && (
        <SectionError onRetry={() => void live.refresh()} retryPending={live.isRefreshing}>
          Der Servicefall konnte nicht aktualisiert werden. Angezeigt wird der letzte bekannte Stand.
        </SectionError>
      )}
      <div>
        <Link
          href="/service/faelle"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Servicefälle
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{item.caseNumber}</span>
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                {SERVICE_CASE_STATUS_LABELS[item.status]}
              </span>
              <span className="text-sm text-muted-foreground">
                {SERVICE_CASE_URGENCY_LABELS[item.urgency]}
              </span>
            </div>
            <h2 className="mt-1 break-words text-xl font-semibold">{item.summary}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.intakeType === 'request' ? 'Aus Anfrage übernommen' : 'Direkt erfasst'} · Aktualisiert{' '}
              {formatGermanMediumDateTime(item.updatedAt)}
            </p>
          </div>
          <span className="flex items-center gap-2">
            <InlinePending active={settling.isBusy('case')} label="Änderungen werden übernommen" />
            <Button type="button" onClick={() => setEditOpen(true)} disabled={live.isStale}>
              <Pencil className="size-4" />
              Bearbeiten
            </Button>
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="space-y-6">
          <ServiceCaseOriginSection item={item} />
          <ServiceCaseTriageSection item={item} />
          {documentsLoadFailed ? (
            <RegionLoadError>Dokumente und Bilder konnten nicht geladen werden.</RegionLoadError>
          ) : (
            <ContextualDocumentsSection
              title="Dokumente & Bilder"
              description="Dokumente werden aus der zentralen Ablage verknüpft. Es entsteht keine Dateikopie."
              documents={documents}
              documentTarget={{ kind: 'service_case', serviceCaseId: item.id }}
              contextLabel={item.caseNumber}
              canUpload
              canManage
              keepUploadedDocumentsVisible
            />
          )}
          <ServiceCaseEvidenceLink
            serviceCase={item}
            options={workspace.evidenceOptions}
            isStale={live.isStale}
            invalidate={live.invalidate}
            refresh={live.refresh}
          />
          <ServiceCaseRelationsSection
            workspace={workspace}
            isStale={live.isStale}
            busy={settling.isBusy('relations')}
            onLinkClick={() => setRelationOpen(true)}
          />
          <ServiceCaseHistorySection item={item} />
        </main>
        <ServiceCaseDetailSidebar
          workspace={workspace}
          isStale={live.isStale}
          onFollowUpClick={() => setFollowUpOpen(true)}
        />
      </div>
      {editOpen && (
        <ServiceCaseFormDialog
          open
          onOpenChange={setEditOpen}
          client={workspace.client}
          initial={item}
          jobs={workspace.jobs}
          onSaved={settleOn('case')}
        />
      )}
      {relationOpen && (
        <RelationDialog
          open
          onOpenChange={setRelationOpen}
          workspace={workspace}
          onSaved={settleOn('relations')}
        />
      )}
      {followUpOpen && <FollowUpDialog open onOpenChange={setFollowUpOpen} workspace={workspace} />}
    </div>
  );
}
