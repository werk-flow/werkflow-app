import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { CalendarClock, Siren, Wrench } from "lucide-react";

import { DetailPageHeader } from "@/components/shared/detail-page-header";
import { PageBody, PageShell } from "@/components/shared/page-shell";
import { Badge } from "@/components/ui/badge";
import { UrlFlashBanner } from "@/components/ui/banner";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { ContextualDocumentsSection } from "@/components/dokumente/contextual-documents-section";
import { FieldWorkPackExecutionSection } from "@/components/auftraege/field-work-pack-execution-section";
import { JobInstructionItemsCard } from "@/components/auftraege/job-instruction-items-card";
import { WorkArtifactsSection } from "@/components/auftraege/work-artifacts-section";
import { FieldWorkPackOverview } from "@/components/auftraege/field-work-pack-overview";
import { FieldWorkPackSource } from "@/components/auftraege/field-work-pack-source";
import { FieldWorkPackTimeSection } from "@/components/auftraege/field-work-pack-time-section";
import { JobMaterialsSection } from "@/components/inventar/job-materials-section";
import { getJobDispatchCards } from "@/lib/dispatch/actions";
import { dispatchErrorMessage } from "@/lib/dispatch/types";
import { getJobDocuments } from "@/lib/documents/actions";
import { getJobMaterialLines } from "@/lib/inventory/actions";
import { getJobByNumber } from "@/lib/jobs/actions";
import {
  isFieldWorkPackReadOnly,
  projectFieldWorkPackJob,
  sanitizeFieldInstructionItems,
} from "@/lib/jobs/field-work-pack";
import { getJobInstructionItems } from "@/lib/jobs/instruction-items-actions";
import type { JobInstructionActor } from "@/lib/jobs/types";
import { getTimeEntriesForJob } from "@/lib/time-tracking/actions";
import { getWorkArtifacts } from "@/lib/work-artifacts/actions";
import { getWorkLifecycleSnapshot } from "@/lib/work-lifecycle/actions";
import { WORK_EXECUTION_LABELS } from "@/lib/work-lifecycle/types";
import { getWorkHandoverFieldStatus } from "@/lib/work-handover/actions";
import { getAssignedEquipmentForJob } from "@/lib/installed-equipment/actions";
import {
  EQUIPMENT_STATE_LABELS,
  EQUIPMENT_SUBTYPE_LABELS,
} from "@/lib/installed-equipment/types";
import { FieldWorkHandoverStatus } from "@/components/auftraege/work-handover-section";
import { getAssignedServiceContextForJob } from "@/lib/service-cases/actions";
import { SERVICE_CASE_URGENCY_LABELS } from "@/lib/service-cases/types";
import { getAssignedMaintenanceContextForJob } from "@/lib/maintenance/actions";

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
  if (!jobResult.success) redirect("/auftraege");

  const job = jobResult.job;
  const currentUserAssignment = job.assignments.find(
    (assignment) => assignment.userId === currentUserId,
  );
  if (!currentUserAssignment) redirect("/auftraege");

  if (expectedProjectNumber) {
    if (
      job.project?.projectNumber !== decodeURIComponent(expectedProjectNumber)
    ) {
      redirect("/auftraege");
    }
  } else if (job.project?.projectNumber) {
    redirect(
      `/auftraege/projekt/${encodeURIComponent(job.project.projectNumber)}/${encodeURIComponent(job.jobNumber!)}`,
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
    equipmentResult,
    serviceContextResult,
    maintenanceContextResult,
  ] = await Promise.all([
    getJobInstructionItems(job.id),
    getJobDocuments(job.id),
    getJobMaterialLines(job.id),
    getWorkLifecycleSnapshot({ targetType: "job", targetId: job.id }),
    getWorkArtifacts({ targetType: "job", targetId: job.id }),
    getTimeEntriesForJob(job.id),
    getJobDispatchCards(job.id),
    getWorkHandoverFieldStatus(job.id),
    getAssignedEquipmentForJob(job.id),
    getAssignedServiceContextForJob(job.id),
    getAssignedMaintenanceContextForJob(job.id),
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
  const dispatchCards = dispatchResult.success
    ? dispatchResult.cards
    : undefined;
  const evidenceRequirements = instructionItems.flatMap(
    (item) => item.evidenceRequirements,
  );
  const timeEntryOptions = timeEntries
    .filter((entry) => entry.entryType === "clock_in" && entry.jobId === job.id)
    .map((entry) => ({
      id: entry.canonicalSegmentId ?? entry.id,
      sourceType: entry.canonicalSegmentId
        ? ("time_segment" as const)
        : ("time_entry" as const),
      label: new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(new Date(entry.timestamp)),
    }));

  return (
    <PageShell className="bg-muted/20">
      <UrlFlashBanner
        paramKey="field_transition"
        messageTemplate="Arbeitsstand wurde aktualisiert."
      />
      <DetailPageHeader
        breadcrumbs={[
          { label: "Aufträge", href: "/auftraege" },
          ...(fieldJob.project ? [{ label: fieldJob.project.name }] : []),
          { label: `Auftrag ${fieldJob.jobNumber ?? "Ohne Nummer"}` },
        ]}
        title={fieldJob.title}
        subtitle={`Auftrag ${fieldJob.jobNumber ?? "Ohne Nummer"}`}
        badges={
          <Badge variant="secondary">
            {lifecycleResult.success
              ? WORK_EXECUTION_LABELS[lifecycleResult.snapshot.executionState]
              : "Arbeitsstand unbekannt"}
          </Badge>
        }
      />

      <PageBody maxWidth="wide">
        {/* The test id scopes the pack's body content; the specs never reach the header through it. */}
        <div data-testid="field-work-pack" className="space-y-4 sm:space-y-6">
          <FieldWorkPackOverview job={fieldJob} />
          <FieldWorkPackSource
            sourceId={`${job.id}:service-context`}
            success={serviceContextResult.success}
            title="Servicekontext nicht verfügbar"
            description="Die für diesen Auftrag freigegebenen Servicehinweise konnten nicht geladen werden."
          >
            {serviceContextResult.success &&
            serviceContextResult.contexts.length > 0 ? (
              <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Siren className="size-4" />
                  Serviceeinsatz
                </h2>
                <div className="mt-3 space-y-3">
                  {serviceContextResult.contexts.map((context) => (
                    <div key={context.caseNumber} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{context.summary}</p>
                        <span className="text-xs text-muted-foreground">
                          {context.caseNumber} · {SERVICE_CASE_URGENCY_LABELS[context.urgency]}
                        </span>
                      </div>
                      {context.accessInstructions && (
                        <p className="mt-2 text-sm">
                          <span className="font-medium">Zugang:</span>{" "}
                          {context.accessInstructions}
                        </p>
                      )}
                      {context.equipment.length > 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          Betroffene Anlagen: {context.equipment.map((item) => `${item.equipmentNumber} · ${item.name}`).join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </FieldWorkPackSource>
          <FieldWorkPackSource
            sourceId={`${job.id}:maintenance-context`}
            success={maintenanceContextResult.success}
            title="Wartungskontext nicht verfügbar"
            description="Die für diesen Auftrag freigegebenen Wartungshinweise konnten nicht geladen werden."
          >
            {maintenanceContextResult.success &&
            maintenanceContextResult.contexts.length > 0 ? (
              <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <CalendarClock className="size-4" />
                  Wartung
                </h2>
                <div className="mt-3 space-y-3">
                  {maintenanceContextResult.contexts.map((context) => (
                    <div
                      key={`${context.planNumber}:${context.dueDate}`}
                      className="rounded-md border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          {context.templateName} · Version {context.templateVersionNumber}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {context.planNumber} · fällig {new Intl.DateTimeFormat("de-DE").format(new Date(`${context.dueDate}T12:00:00Z`))}
                        </span>
                      </div>
                      {context.operationalInstructions && (
                        <p className="mt-2 text-sm">{context.operationalInstructions}</p>
                      )}
                      <p className="mt-2 text-sm text-muted-foreground">
                        Anlagen: {context.equipment.map((item) => `${item.equipmentNumber} · ${item.name}`).join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </FieldWorkPackSource>
          <FieldWorkPackExecutionSection
            key={job.id}
            jobId={job.id}
            jobTitle={job.title}
            initialDispatchCards={dispatchCards}
            initialDispatchError={
              dispatchResult.success
                ? null
                : dispatchErrorMessage(dispatchResult.error)
            }
            lifecycleSnapshot={
              lifecycleResult.success ? lifecycleResult.snapshot : null
            }
            readOnly={readOnly}
          />

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
                key={
                  documents.map((document) => document.id).join(":") || "empty"
                }
                title="Dokumente & Bilder"
                description="Dateien zu diesem Auftrag ansehen oder direkt vom Einsatz hochladen."
                documents={documents}
                documentTarget={{ kind: "job", jobId: job.id }}
                contextLabel={job.title}
                canUpload={!readOnly}
                canManage={false}
                emphasizeUpload={false}
                keepUploadedDocumentsVisible
              />
            ) : null}
          </FieldWorkPackSource>

          <FieldWorkPackSource
            sourceId={`${job.id}:equipment`}
            success={equipmentResult.success}
            title="Anlagendaten nicht verfügbar"
            description="Die ausdrücklich mit diesem Auftrag verknüpften Anlagen konnten nicht geladen werden."
          >
            {equipmentResult.success && equipmentResult.equipment.length > 0 ? (
              <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Wrench className="size-4" />
                  Anlagen am Einsatzort
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Nur Anlagen, die ausdrücklich mit diesem Auftrag verknüpft sind.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {equipmentResult.equipment.map((item) => (
                    <div key={item.id} className="rounded-md border p-3">
                      <p className="font-medium">{item.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.equipmentNumber} ·{" "}
                        {EQUIPMENT_STATE_LABELS[item.state]}
                      </p>
                      <p className="mt-2 text-sm">
                        {[item.manufacturer, item.model]
                          .filter(Boolean)
                          .join(" · ") || "Hersteller und Modell nicht erfasst"}
                      </p>
                      {(item.subtype || item.locationDetail) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[
                            item.subtype
                              ? EQUIPMENT_SUBTYPE_LABELS[item.subtype]
                              : null,
                            item.locationDetail,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </FieldWorkPackSource>

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <FieldWorkPackSource
              sourceId={`${job.id}:time`}
              success={timeResult.success}
              title="Zeiten nicht verfügbar"
              description="Deine bisherigen Zeiten zu diesem Auftrag konnten nicht geladen werden."
            >
              {timeResult.success ? (
                <FieldWorkPackTimeSection
                  jobId={job.id}
                  currentUserId={currentUserId}
                  entries={timeEntries}
                  loadError={false}
                  readOnly={readOnly}
                />
              ) : null}
            </FieldWorkPackSource>
            <FieldWorkPackSource
              sourceId={`${job.id}:materials`}
              success={materialLinesResult.success}
              title="Material nicht verfügbar"
              description="Materialbedarf und Bewegungen konnten nicht geladen werden. Es wird kein Bestand als verfügbar angenommen."
            >
              {materialLinesResult.success ? (
                <JobMaterialsSection
                  key={
                    materialLines
                      .map(
                        (line) =>
                          `${line.id}:${line.takenQuantity}:${line.returnedQuantity}`,
                      )
                      .join("|") || "empty"
                  }
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

          <section
            className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
            aria-labelledby="field-reference-heading"
          >
            <FormDisclosure label="Weitere Auftragsangaben">
              <div className="space-y-2 pt-3 text-sm">
                <h2 id="field-reference-heading" className="sr-only">
                  Weitere Auftragsangaben
                </h2>
                {fieldJob.project ? (
                  <p>
                    <span className="text-muted-foreground">Projekt:</span>{" "}
                    {fieldJob.project.name} · {fieldJob.project.projectNumber}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Dieser Auftrag gehört zu keinem Projekt.
                  </p>
                )}
                <p className="text-muted-foreground">
                  Planung, Zeiterfassung, Material, Dokumente und Nachweise
                  bleiben getrennte verbindliche Bereiche.
                </p>
              </div>
            </FormDisclosure>
          </section>
        </div>
      </PageBody>
    </PageShell>
  );
}
