import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { JobInstructionItemsCard } from '@/components/auftraege/instructions/job-instruction-items-card';
import { WorkArtifactsSection } from '@/components/auftraege/artifacts/work-artifacts-section';
import { FieldWorkPackSource } from '@/components/auftraege/work-pack/field-work-pack-source';
import { FieldWorkPackTimeSection } from '@/components/auftraege/work-pack/field-work-pack-time-section';
import { JobMaterialsSection } from '@/components/inventar/job-materials-section';
import { FieldWorkHandoverStatus } from '@/components/auftraege/handover/work-handover-section';
import type { JobWithDetails } from '@/lib/jobs/types';
import type { FieldWorkPackData } from './field-work-pack-data';

type FieldWorkPackRecordProps = {
  job: JobWithDetails;
  currentUserId: string;
  data: FieldWorkPackData;
};

/** Handover status, instructions, work artifacts and documents of the job. */
export function FieldWorkPackRecordSources({ job, currentUserId, data }: FieldWorkPackRecordProps) {
  const {
    handoverStatusResult,
    instructionItemsResult,
    instructionItems,
    currentUserActor,
    readOnly,
    artifactsResult,
    documents,
    evidenceRequirements,
    timeEntryOptions,
    documentsResult,
  } = data;
  return (
    <>
      <FieldWorkPackSource
        sourceId={`${job.id}:handover`}
        success={handoverStatusResult.success}
        title="Übergabestand nicht verfügbar"
        description="Der Übergabestand konnte nicht geladen werden. Bitte lade ihn erneut, bevor du dich darauf verlässt."
      >
        {handoverStatusResult.success ? (
          <FieldWorkHandoverStatus status={handoverStatusResult.status} />
        ) : null}
      </FieldWorkPackSource>

      <FieldWorkPackSource
        sourceId={`${job.id}:instructions`}
        success={instructionItemsResult.success}
        title="Arbeitsanweisungen nicht verfügbar"
        description="Aufgaben und Nachweiserwartungen konnten nicht geladen werden. Sie werden nicht als erledigt angenommen."
      >
        {instructionItemsResult.success ? (
          <JobInstructionItemsCard
            jobId={job.id}
            initialItems={instructionItems}
            isAdminOrManager={false}
            currentUserActor={currentUserActor}
            readOnly={readOnly}
          />
        ) : null}
      </FieldWorkPackSource>

      <FieldWorkPackSource
        sourceId={`${job.id}:artifacts`}
        success={artifactsResult.success}
        title="Arbeitsnachweise nicht verfügbar"
        description="Fortschritt und Nachweise konnten nicht geladen werden. Bitte lade die Seite erneut, bevor du etwas dokumentierst."
      >
        {artifactsResult.success ? (
          <WorkArtifactsSection
            key={job.id}
            targetType="job"
            targetId={job.id}
            initialArtifacts={artifactsResult.artifacts}
            isManager={false}
            canApprove={false}
            currentUserId={currentUserId}
            documents={documents}
            evidenceRequirements={evidenceRequirements}
            instructionOptions={instructionItems.map((item) => ({
              id: item.id,
              label: item.content,
            }))}
            defaultSiteId={job.site?.id}
            timeEntryOptions={timeEntryOptions}
            readOnly={readOnly}
          />
        ) : null}
      </FieldWorkPackSource>

      <FieldWorkPackSource
        sourceId={`${job.id}:documents`}
        success={documentsResult.success}
        title="Dokumente nicht verfügbar"
        description="Dokumente und Bilder konnten nicht geladen werden. Ein fehlgeschlagener Abruf wird nicht als leere Ablage angezeigt."
      >
        {documentsResult.success ? (
          <ContextualDocumentsSection
            title="Dokumente & Bilder"
            description="Dateien zu diesem Auftrag ansehen oder direkt vom Einsatz hochladen."
            documents={documents}
            documentTarget={{ kind: 'job', jobId: job.id }}
            contextLabel={job.title}
            canUpload={!readOnly}
            canManage={false}
            emphasizeUpload={false}
            keepUploadedDocumentsVisible
          />
        ) : null}
      </FieldWorkPackSource>
    </>
  );
}

/** The worker's own time and the job's material, side by side. */
export function FieldWorkPackTimeAndMaterials({ job, currentUserId, data }: FieldWorkPackRecordProps) {
  const { timeResult, timeEntries, readOnly, materialLinesResult, materialLines } = data;
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      {/* The clock controls read the clock state, not this history, so a
          failed history read shows its own retry and keeps them usable. */}
      <FieldWorkPackTimeSection
        jobId={job.id}
        currentUserId={currentUserId}
        entries={timeEntries}
        loadError={!timeResult.success}
        readOnly={readOnly}
      />
      <FieldWorkPackSource
        sourceId={`${job.id}:materials`}
        success={materialLinesResult.success}
        title="Material nicht verfügbar"
        description="Materialbedarf und Bewegungen konnten nicht geladen werden. Es wird kein Bestand als verfügbar angenommen."
      >
        {materialLinesResult.success ? (
          // Not keyed by the booked quantities: the section's live view
          // reads fresh lines itself, and a remount on the next route
          // refresh closed a dialog the worker had just opened (A1-39).
          <JobMaterialsSection
            jobId={job.id}
            initialLines={materialLines}
            inventoryItems={[]}
            locations={[]}
            isAdminOrManager={false}
            readOnly={readOnly}
          />
        ) : null}
      </FieldWorkPackSource>
    </div>
  );
}
