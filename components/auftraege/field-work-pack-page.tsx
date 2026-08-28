import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { Badge } from '@/components/ui/badge';
import { UrlFlashBanner } from '@/components/ui/banner';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { FieldWorkPackExecutionSection } from '@/components/auftraege/field-work-pack-execution-section';
import { JobInstructionItemsCard } from '@/components/auftraege/job-instruction-items-card';
import { WorkArtifactsSection } from '@/components/auftraege/work-artifacts-section';
import { FieldWorkPackOverview } from '@/components/auftraege/field-work-pack-overview';
import { FieldWorkPackSource } from '@/components/auftraege/field-work-pack-source';
import { FieldWorkPackTimeSection } from '@/components/auftraege/field-work-pack-time-section';
import { JobMaterialsSection } from '@/components/inventar/job-materials-section';
import { getJobDispatchCards } from '@/lib/dispatch/actions';
import { dispatchErrorMessage } from '@/lib/dispatch/types';
import { getJobDocuments } from '@/lib/documents/actions';
import { getJobMaterialLines } from '@/lib/inventory/actions';
import { getJobByNumber } from '@/lib/jobs/actions';
import {
  isFieldWorkPackReadOnly,
  projectFieldWorkPackJob,
  sanitizeFieldInstructionItems,
} from '@/lib/jobs/field-work-pack';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import type { JobInstructionActor } from '@/lib/jobs/types';
import { getTimeEntriesForJob } from '@/lib/time-tracking/actions';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import { getWorkLifecycleSnapshot } from '@/lib/work-lifecycle/actions';
import { WORK_EXECUTION_LABELS } from '@/lib/work-lifecycle/types';
import { getWorkHandoverFieldStatus } from '@/lib/work-handover/actions';
import { FieldWorkHandoverStatus } from '@/components/auftraege/work-handover-section';

export async function FieldWorkPackPage({
  jobNumber,
  expectedProjectNumber,
  currentUserId,
}: {
  jobNumber: string;
  expectedProjectNumber?: string;
  currentUserId: string;
}): Promise<ReactElement> {
  const jobResult = await getJobByNumber(decodeURIComponent(jobNumber));
  if (!jobResult.success) redirect('/auftraege');

  const job = jobResult.job;
  const currentUserAssignment = job.assignments.find(
    (assignment) => assignment.userId === currentUserId
  );
  if (!currentUserAssignment) redirect('/auftraege');

  if (expectedProjectNumber) {
    if (job.project?.projectNumber !== decodeURIComponent(expectedProjectNumber)) {
      redirect('/auftraege');
    }
  } else if (job.project?.projectNumber) {
    redirect(
      `/auftraege/projekt/${encodeURIComponent(job.project.projectNumber)}/${encodeURIComponent(job.jobNumber!)}`
    );
  }

  const [
    instructionItemsResult,
    documentsResult,
    materialLinesResult,
    lifecycleResult,
    artifactsResult,
    timeResult,
    dispatchResult,
    handoverStatusResult,
  ] = await Promise.all([
    getJobInstructionItems(job.id),
    getJobDocuments(job.id),
    getJobMaterialLines(job.id),
    getWorkLifecycleSnapshot({ targetType: 'job', targetId: job.id }),
    getWorkArtifacts({ targetType: 'job', targetId: job.id }),
    getTimeEntriesForJob(job.id),
    getJobDispatchCards(job.id),
    getWorkHandoverFieldStatus(job.id),
  ]);

  const fieldJob = projectFieldWorkPackJob(job);
  const instructionItems = instructionItemsResult.success
    ? sanitizeFieldInstructionItems(instructionItemsResult.items)
    : [];
  const documents = documentsResult.success ? documentsResult.documents : [];
  const materialLines = materialLinesResult.success
    ? materialLinesResult.lines.map((line) => ({
        ...line,
        billableQuantity: 0,
        isBillable: false,
      }))
    : [];
  const timeEntries = timeResult.success
    ? timeResult.entries.filter((entry) => entry.userId === currentUserId)
    : [];
  const currentUserActor: JobInstructionActor = {
    userId: currentUserId,
    firstName: currentUserAssignment.firstName,
    lastName: currentUserAssignment.lastName,
    email: null,
    avatarPath: null,
  };
  const readOnly = lifecycleResult.success
    ? isFieldWorkPackReadOnly(lifecycleResult.snapshot.executionState)
    : true;
  const dispatchCards = dispatchResult.success ? dispatchResult.cards : undefined;
  const evidenceRequirements = instructionItems.flatMap((item) => item.evidenceRequirements);
  const timeEntryOptions = timeEntries
    .filter((entry) => entry.entryType === 'clock_in' && entry.jobId === job.id)
    .map((entry) => ({
      id: entry.id,
      label: new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Berlin',
      }).format(new Date(entry.timestamp)),
    }));

  return (
    <div className="min-h-full bg-muted/20" data-testid="field-work-pack">
      <UrlFlashBanner paramKey="field_transition" messageTemplate="Arbeitsstand wurde aktualisiert." />
      <DetailPageHeader
        breadcrumbs={[
          { label: 'Aufträge', href: '/auftraege' },
          ...(fieldJob.project ? [{ label: fieldJob.project.name }] : []),
          { label: `Auftrag ${fieldJob.jobNumber ?? 'Ohne Nummer'}` },
        ]}
        title={fieldJob.title}
        subtitle={`Auftrag ${fieldJob.jobNumber ?? 'Ohne Nummer'}`}
        badges={
          <Badge variant="secondary">
            {lifecycleResult.success
              ? WORK_EXECUTION_LABELS[lifecycleResult.snapshot.executionState]
              : 'Arbeitsstand unbekannt'}
          </Badge>
        }
      />

      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6">
        <FieldWorkPackOverview job={fieldJob} />
        <FieldWorkPackExecutionSection
          key={job.id}
          jobId={job.id}
          jobTitle={job.title}
          initialDispatchCards={dispatchCards}
          initialDispatchError={dispatchResult.success ? null : dispatchErrorMessage(dispatchResult.error)}
          lifecycleSnapshot={lifecycleResult.success ? lifecycleResult.snapshot : null}
          readOnly={readOnly}
        />

        <FieldWorkPackSource
          sourceId={`${job.id}:handover`}
          success={handoverStatusResult.success}
          title="Übergabestand nicht verfügbar"
          description="Der Übergabestand konnte nicht geladen werden. Bitte lade ihn erneut, bevor du dich darauf verlässt."
        >
          {handoverStatusResult.success
            ? <FieldWorkHandoverStatus status={handoverStatusResult.status} />
            : null}
        </FieldWorkPackSource>

        <FieldWorkPackSource
          sourceId={`${job.id}:instructions`}
          success={instructionItemsResult.success}
          title="Arbeitsanweisungen nicht verfügbar"
          description="Aufgaben und Nachweiserwartungen konnten nicht geladen werden. Sie werden nicht als erledigt angenommen."
        >
          {instructionItemsResult.success ? <JobInstructionItemsCard
            jobId={job.id}
            initialItems={instructionItems}
            isAdminOrManager={false}
            currentUserActor={currentUserActor}
            readOnly={readOnly}
          /> : null}
        </FieldWorkPackSource>

        <FieldWorkPackSource
          sourceId={`${job.id}:artifacts`}
          success={artifactsResult.success}
          title="Arbeitsnachweise nicht verfügbar"
          description="Fortschritt und Nachweise konnten nicht geladen werden. Bitte lade die Seite erneut, bevor du etwas dokumentierst."
        >
          {artifactsResult.success ? <WorkArtifactsSection
            key={job.id}
            targetType="job"
            targetId={job.id}
            initialArtifacts={artifactsResult.artifacts}
            isManager={false}
            canApprove={false}
            currentUserId={currentUserId}
            documents={documents}
            evidenceRequirements={evidenceRequirements}
            instructionOptions={instructionItems.map((item) => ({ id: item.id, label: item.content }))}
            defaultSiteId={job.site?.id}
            timeEntryOptions={timeEntryOptions}
            readOnly={readOnly}
          /> : null}
        </FieldWorkPackSource>

        <FieldWorkPackSource
          sourceId={`${job.id}:documents`}
          success={documentsResult.success}
          title="Dokumente nicht verfügbar"
          description="Dokumente und Bilder konnten nicht geladen werden. Ein fehlgeschlagener Abruf wird nicht als leere Ablage angezeigt."
        >
          {documentsResult.success ? <ContextualDocumentsSection
            key={documents.map((document) => document.id).join(':') || 'empty'}
            title="Dokumente & Bilder"
            description="Dateien zu diesem Auftrag ansehen oder direkt vom Einsatz hochladen."
            documents={documents}
            jobId={job.id}
            contextLabel={job.title}
            canUpload={!readOnly}
            canManage={false}
            emphasizeUpload={false}
            keepUploadedDocumentsVisible
          /> : null}
        </FieldWorkPackSource>

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <FieldWorkPackSource
            sourceId={`${job.id}:time`}
            success={timeResult.success}
            title="Zeiten nicht verfügbar"
            description="Deine bisherigen Zeiten zu diesem Auftrag konnten nicht geladen werden."
          >
            {timeResult.success ? <FieldWorkPackTimeSection
              jobId={job.id}
              currentUserId={currentUserId}
              entries={timeEntries}
              loadError={false}
              readOnly={readOnly}
            /> : null}
          </FieldWorkPackSource>
          <FieldWorkPackSource
            sourceId={`${job.id}:materials`}
            success={materialLinesResult.success}
            title="Material nicht verfügbar"
            description="Materialbedarf und Bewegungen konnten nicht geladen werden. Es wird kein Bestand als verfügbar angenommen."
          >
            {materialLinesResult.success ? <JobMaterialsSection
              key={materialLines.map((line) => `${line.id}:${line.takenQuantity}:${line.returnedQuantity}`).join('|') || 'empty'}
              jobId={job.id}
              initialLines={materialLines}
              inventoryItems={[]}
              locations={[]}
              isAdminOrManager={false}
              readOnly={readOnly}
            /> : null}
          </FieldWorkPackSource>
        </div>

        <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5" aria-labelledby="field-reference-heading">
          <FormDisclosure label="Weitere Auftragsangaben">
            <div className="space-y-2 pt-3 text-sm">
              <h2 id="field-reference-heading" className="sr-only">Weitere Auftragsangaben</h2>
              {fieldJob.project ? (
                <p><span className="text-muted-foreground">Projekt:</span> {fieldJob.project.name} · {fieldJob.project.projectNumber}</p>
              ) : (
                <p className="text-muted-foreground">Dieser Auftrag gehört zu keinem Projekt.</p>
              )}
              <p className="text-muted-foreground">
                Planung, Zeiterfassung, Material, Dokumente und Nachweise bleiben getrennte verbindliche Bereiche.
              </p>
            </div>
          </FormDisclosure>
        </section>
      </main>
    </div>
  );
}
