'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Download, Loader2, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { DateTimeField } from '@/components/ui/date-time-field';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBanner } from '@/components/ui/banner';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { uploadDocumentDirect } from '@/lib/documents/upload-client';
import type { OrganizationDocument } from '@/lib/documents/types';
import {
  exportWorkArtifact, fulfillInstructionEvidence, getWorkArtifactDetail,
  getWorkArtifacts, linkWorkArtifactDocument, linkWorkArtifactSource, recordWorkArtifactAction,
  removeInstructionEvidenceFulfillment, saveWorkArtifact, voidWorkArtifact,
  discardUnlinkedWorkArtifactSignature,
} from '@/lib/work-artifacts/actions';
import {
  WORK_ARTIFACT_KIND_LABELS, WORK_ARTIFACT_KINDS, WORK_ARTIFACT_LEGAL_NOTICE,
  WORK_ARTIFACT_STATUS_LABELS, WORK_ARTIFACT_UNIT_LABELS,
  type MeasurementLineInput, type WorkArtifactActionType,
  type WorkArtifactContentInput, type WorkArtifactDetail, type WorkArtifactKind,
  type WorkArtifactSummary, type WorkArtifactVisibility,
} from '@/lib/work-artifacts/types';
import { SignaturePad } from './signature-pad';
import { toLocalDateString } from '@/lib/utils';

type EvidenceRequirement = { id: string; description: string; documentCategory: string; fulfillment?: { id: string; version: number } | null };
type Target = { targetType: 'job' | 'project'; targetId: string };

const ACTION_LABELS: Partial<Record<WorkArtifactActionType, string>> = {
  review_requested: 'Zur Prüfung eingereicht', review_withdrawn: 'Prüfung zurückgezogen',
  internal_approved: 'Intern freigegeben', internal_rejected: 'Abgelehnt',
  correction_requested: 'Korrektur angefordert', customer_acknowledged: 'Vom Kunden bestätigt',
  customer_refused: 'Vom Kunden abgelehnt', customer_reserved: 'Mit Vorbehalt bestätigt',
  signature_captured: 'Unterschrift erfasst', exported: 'Export erstellt', voided: 'Ungültig gesetzt',
};
const DOCUMENT_RELATION_LABELS = {
  supporting_evidence: 'Nachweis', closure_proof: 'Abschlussnachweis',
  signature_mark: 'Unterschrift', rendered_export: 'Gerenderter Export',
} as const;

const EMPTY_CONTENT: WorkArtifactContentInput = {
  summary: '', progress: '', performedWork: '', outstandingWork: '', materialsSummary: '',
  measurementLocation: '', measurementNotes: '', measurementLines: [],
  defectDescription: '', defectSeverity: 'medium', defectLocation: '', defectState: 'open',
  proposedResolution: '', resolutionSummary: '', changeDescription: '', changeReason: '',
  requestedByContext: '', authorizationState: 'not_requested', scheduleImpact: '',
};

function localDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function iso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function displayDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== '' && entry !== undefined)) as T;
}

function contentFromDetail(detail: WorkArtifactDetail): WorkArtifactContentInput {
  const revision = detail.revisions.find((entry) => entry.id === detail.current_revision_id);
  if (!revision) return { ...EMPTY_CONTENT };
  const defect = detail.defectDetails.find((entry) => entry.revision_id === revision.id);
  const change = detail.changeDetails.find((entry) => entry.revision_id === revision.id);
  return compact({
    siteId: revision.site_id ?? '', instructionItemId: revision.instruction_item_id ?? '',
    summary: revision.summary ?? '', customerStatement: revision.customer_statement ?? '',
    requiresCustomerResponse: revision.requires_customer_response,
    requiresSignature: revision.requires_signature, workDate: revision.work_date ?? '',
    progress: revision.progress ?? '', peoplePresent: revision.people_present ?? '',
    weatherConditions: revision.weather_conditions ?? '', siteConditions: revision.site_conditions ?? '',
    deliveries: revision.deliveries ?? '', impediments: revision.impediments ?? '',
    decisions: revision.decisions ?? '', notableEvents: revision.notable_events ?? '',
    visitStartedAt: localDateTime(revision.visit_started_at), visitEndedAt: localDateTime(revision.visit_ended_at),
    performedWork: revision.performed_work ?? '', outstandingWork: revision.outstanding_work ?? '',
    materialsSummary: revision.materials_summary ?? '', nextVisitAt: localDateTime(revision.next_visit_at),
    measurementDate: revision.measurement_date ?? '', measurementLocation: revision.measurement_location ?? '',
    measurementNotes: revision.measurement_notes ?? '',
    measurementLines: detail.measurementLines.filter((line) => line.revision_id === revision.id).map((line) => ({
      id: line.id, description: line.description, location: line.location ?? '',
      quantity: String(line.quantity).replace('.', ','), unit: line.unit, note: line.note ?? '',
    })),
    defectDescription: defect?.description ?? '', defectSeverity: defect?.severity ?? 'medium',
    defectLocation: defect?.location ?? '', responsibleEmployeeRecordId: defect?.responsible_employee_record_id ?? '',
    responsibilityContext: defect?.responsibility_context ?? '', dueDate: defect?.due_date ?? '',
    defectState: defect?.state ?? 'open', proposedResolution: defect?.proposed_resolution ?? '',
    resolutionSummary: defect?.resolution_summary ?? '', changeDescription: change?.change_description ?? '',
    changeReason: change?.change_reason ?? '', requestedByContext: change?.requested_by_context ?? '',
    expectedLaborMinutes: change?.expected_labor_minutes == null ? '' : String(change.expected_labor_minutes),
    actualLaborMinutes: change?.actual_labor_minutes == null ? '' : String(change.actual_labor_minutes),
    expectedMaterialSummary: change?.expected_material_summary ?? '', actualMaterialSummary: change?.actual_material_summary ?? '',
    authorizationState: change?.authorization_state ?? 'not_requested', scheduleImpact: change?.schedule_impact ?? '',
  });
}

export function WorkArtifactsSection({
  targetType, targetId, initialArtifacts, isManager, canApprove, currentUserId, documents, evidenceRequirements = [],
  timeEntryOptions = [],
  instructionOptions = [], defaultSiteId,
}: Target & {
  initialArtifacts: WorkArtifactSummary[]; isManager: boolean; canApprove: boolean; currentUserId: string;
  documents: OrganizationDocument[]; evidenceRequirements?: EvidenceRequirement[];
  timeEntryOptions?: Array<{ id: string; label: string }>;
  instructionOptions?: Array<{ id: string; label: string }>;
  defaultSiteId?: string;
}) {
  const searchParams = useSearchParams();
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const requestedId = searchParams.get('arbeitsnachweis');
    return initialArtifacts.some((artifact) => artifact.id === requestedId) ? requestedId : null;
  });
  const [creating, setCreating] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refresh() {
    startRefresh(async () => {
      const result = await getWorkArtifacts({ targetType, targetId });
      if (result.success) setArtifacts(result.artifacts);
    });
  }
  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);
  useRealtimeEvent('work_artifacts', (event) => {
    const row = event.new ?? event.old;
    const targetColumn = targetType === 'job' ? 'job_id' : 'project_id';
    if (row?.[targetColumn] !== targetId) return;
    if (selectedId || creating) {
      setHasRemoteUpdate(true);
      return;
    }
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(refresh, 150);
  });

  return (
    <section id="arbeitsnachweise" data-testid="work-artifacts-section" className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <ClipboardList className="size-4" />Arbeitsnachweise
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">Bautagebuch, Arbeitsbericht, Aufmaß, Mangel und Regiearbeit versionssicher erfassen.</p>
        </div>
        <Button size="sm" className="min-h-11 sm:min-h-0" onClick={() => setCreating(true)}>
          <Plus className="size-4" />Neu
        </Button>
      </div>
      {artifacts.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Arbeitsnachweise erfasst.
        </p>
      ) : (
        <div className="mt-4 divide-y rounded-md border">
          {artifacts.map((artifact) => (
            <button key={artifact.id} type="button" data-artifact-id={artifact.id} onClick={() => setSelectedId(artifact.id)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{artifact.currentRevision.title}</p>
                <p className="text-xs text-muted-foreground">
                  {WORK_ARTIFACT_KIND_LABELS[artifact.kind]} · Version {artifact.currentRevision.revision_number}
                </p>
              </div>
              <Badge variant="outline">{WORK_ARTIFACT_STATUS_LABELS[artifact.status]}</Badge>
            </button>
          ))}
        </div>
      )}
      {isRefreshing && <p className="mt-2 text-xs text-muted-foreground">Arbeitsnachweise werden aktualisiert…</p>}
      {(creating || selectedId) && (
        <WorkArtifactDialog
          targetType={targetType} targetId={targetId} artifactId={selectedId}
          initialSummary={artifacts.find((artifact) => artifact.id === selectedId) ?? null}
          isManager={isManager} canApprove={canApprove} currentUserId={currentUserId} documents={documents}
          evidenceRequirements={evidenceRequirements} timeEntryOptions={timeEntryOptions}
          instructionOptions={instructionOptions} defaultSiteId={defaultSiteId}
          hasRemoteUpdate={hasRemoteUpdate}
          onRemoteUpdateHandled={() => setHasRemoteUpdate(false)}
          onClose={() => { setCreating(false); setSelectedId(null); setHasRemoteUpdate(false); refresh(); }}
        />
      )}
    </section>
  );
}

function WorkArtifactDialog({
  targetType, targetId, artifactId, initialSummary, isManager, canApprove, currentUserId,
  documents, evidenceRequirements, onClose,
  timeEntryOptions,
  instructionOptions, defaultSiteId,
  hasRemoteUpdate, onRemoteUpdateHandled,
}: Target & {
  artifactId: string | null; initialSummary: WorkArtifactSummary | null; isManager: boolean; canApprove: boolean;
  currentUserId: string; documents: OrganizationDocument[]; evidenceRequirements: EvidenceRequirement[];
  timeEntryOptions: Array<{ id: string; label: string }>;
  instructionOptions: Array<{ id: string; label: string }>;
  defaultSiteId?: string;
  hasRemoteUpdate: boolean;
  onRemoteUpdateHandled: () => void;
  onClose: () => void;
}) {
  const { showBanner } = useBanner();
  const [detail, setDetail] = useState<WorkArtifactDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(artifactId));
  const [editing, setEditing] = useState(!artifactId);
  const [kind, setKind] = useState<WorkArtifactKind>(initialSummary?.kind ?? 'work_report');
  const [visibility, setVisibility] = useState<WorkArtifactVisibility>(initialSummary?.currentRevision.visibility ?? 'internal_only');
  const [title, setTitle] = useState(initialSummary?.currentRevision.title ?? '');
  const [capturedAt, setCapturedAt] = useState(localDateTime(initialSummary?.currentRevision.captured_at) || localDateTime(new Date().toISOString()));
  const [content, setContent] = useState<WorkArtifactContentInput>({ ...EMPTY_CONTENT, siteId: defaultSiteId });
  const [correctionReason, setCorrectionReason] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerRole, setCustomerRole] = useState('');
  const [customerRelationship, setCustomerRelationship] = useState('Ansprechperson vor Ort');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [pendingSignatureDocumentId, setPendingSignatureDocumentId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [documentRelation, setDocumentRelation] = useState<'supporting_evidence' | 'closure_proof'>('supporting_evidence');
  const [timeEntryId, setTimeEntryId] = useState('');
  const draftArtifactIdRef = useRef(crypto.randomUUID());
  const [localFulfillments, setLocalFulfillments] = useState(
    () => new Map<string, { id: string; version: number }>()
  );
  const [removedFulfillmentIds, setRemovedFulfillmentIds] = useState(() => new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function load(id: string) {
    setLoading(true);
    const result = await getWorkArtifactDetail(id);
    setLoading(false);
    if (!result.success) { setError('Der Arbeitsnachweis konnte nicht geladen werden.'); return; }
    setDetail(result.artifact);
    setKind(result.artifact.kind);
    const revision = result.artifact.revisions.find((entry) => entry.id === result.artifact.current_revision_id);
    if (revision) {
      setVisibility(revision.visibility); setTitle(revision.title);
      setCapturedAt(localDateTime(revision.captured_at)); setContent(contentFromDetail(result.artifact));
    }
  }
  useEffect(() => {
    if (!artifactId) return;
    let active = true;
    void getWorkArtifactDetail(artifactId).then((result) => {
      if (!active) return;
      setLoading(false);
      if (!result.success) { setError('Der Arbeitsnachweis konnte nicht geladen werden.'); return; }
      setDetail(result.artifact);
      setKind(result.artifact.kind);
      const revision = result.artifact.revisions.find((entry) => entry.id === result.artifact.current_revision_id);
      if (revision) {
        setVisibility(revision.visibility); setTitle(revision.title);
        setCapturedAt(localDateTime(revision.captured_at)); setContent(contentFromDetail(result.artifact));
      }
    });
    return () => { active = false; };
  }, [artifactId]);

  const currentRevision = detail?.revisions.find((entry) => entry.id === detail.current_revision_id) ?? null;
  const requiresCorrectionReason = Boolean(detail && (detail.status !== 'draft' || detail.actions.length > 0));
  const canVoid = Boolean(detail && (isManager
    || (detail.status === 'draft' && detail.created_by === currentUserId && detail.actions.length === 0)));
  const measurementLines = content.measurementLines ?? [];

  function patchContent(patch: Partial<WorkArtifactContentInput>) {
    setContent((current) => ({ ...current, ...patch }));
  }

  async function handleMutationFailure(
    result: { success: boolean; error?: string },
    message: string,
    reloadOnConflict = true
  ): Promise<boolean> {
    if (result.success) return false;
    if (result.error?.includes('stale')) {
      if (reloadOnConflict && detail) await load(detail.id);
      setError(reloadOnConflict
        ? 'Der Arbeitsnachweis wurde zwischenzeitlich geändert. Der aktuelle Stand wurde geladen.'
        : 'Der Arbeitsnachweis wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten.');
      return true;
    }
    setError(message);
    return true;
  }

  function save(submit: boolean) {
    setError(null);
    startTransition(async () => {
      const id = detail?.id ?? draftArtifactIdRef.current;
      const result = await saveWorkArtifact({
        artifactId: id, revisionId: crypto.randomUUID(), expectedVersion: detail?.version ?? null,
        targetType, targetId, kind, visibility, capturedAt: iso(capturedAt) ?? new Date().toISOString(), title,
        content: compact({ ...content, visitStartedAt: iso(content.visitStartedAt ?? ''),
          visitEndedAt: iso(content.visitEndedAt ?? ''), nextVisitAt: iso(content.nextVisitAt ?? '') }),
        correctsRevisionId: requiresCorrectionReason ? currentRevision?.id : undefined,
        correctionReason: requiresCorrectionReason ? correctionReason : undefined,
        submit, submitActionId: submit ? crypto.randomUUID() : undefined,
      });
      if (!result.success) {
        if (result.error === 'invalid_input') setError('Bitte fülle die Pflichtangaben der gewählten Art aus.');
        else await handleMutationFailure(result, 'Der Arbeitsnachweis konnte nicht gespeichert werden.', false);
        return;
      }
      await load(result.artifactId); setEditing(false); setCorrectionReason('');
      showBanner({ variant: 'success', message: submit ? 'Arbeitsnachweis wurde zur Prüfung eingereicht.' : 'Arbeitsnachweis wurde gespeichert.' });
    });
  }

  function act(actionType: WorkArtifactActionType, reason?: string) {
    if (!detail || !currentRevision) return;
    setError(null);
    startTransition(async () => {
      const result = await recordWorkArtifactAction({ artifactId: detail.id, revisionId: currentRevision.id,
        actionId: crypto.randomUUID(), expectedVersion: detail.version, actionType, reason });
      if (await handleMutationFailure(result, 'Die Aktion konnte nicht gespeichert werden. Prüfe Berechtigung und aktuellen Stand.')) return;
      await load(detail.id); setActionReason(''); showBanner({ variant: 'success', message: 'Aktion wurde gespeichert.' });
    });
  }

  function customerAction(actionType: 'customer_acknowledged' | 'customer_refused' | 'customer_reserved') {
    if (!detail || !currentRevision) return;
    setError(null);
    startTransition(async () => {
      const result = await recordWorkArtifactAction({
        artifactId: detail.id, revisionId: currentRevision.id, actionId: crypto.randomUUID(),
        expectedVersion: detail.version, actionType,
        reason: actionType === 'customer_acknowledged' ? undefined : actionReason,
        customerContext: { signerName: customerName, signerRole: customerRole || undefined,
          signerRelationship: customerRelationship, captureMethod: 'Persönlich vor Ort',
          wordingSnapshot: WORK_ARTIFACT_LEGAL_NOTICE },
      });
      if (await handleMutationFailure(result, 'Die Kundenentscheidung konnte nicht gespeichert werden.')) return;
      await load(detail.id); setActionReason(''); showBanner({ variant: 'success', message: 'Kundenentscheidung wurde dokumentiert.' });
    });
  }

  function captureSignature() {
    if (!detail || !currentRevision || !signatureFile) return;
    setError(null);
    startTransition(async () => {
      let signatureDocumentId = pendingSignatureDocumentId;
      if (!signatureDocumentId) {
        const uploaded = await uploadDocumentDirect({ file: signatureFile,
          target: targetType === 'job' ? { jobId: targetId } : { projectId: targetId }, category: 'photo' });
        if (!uploaded.success) { setError('Die Unterschrift konnte nicht hochgeladen werden.'); return; }
        signatureDocumentId = uploaded.document.id;
        setPendingSignatureDocumentId(signatureDocumentId);
      }
      const result = await recordWorkArtifactAction({ artifactId: detail.id, revisionId: currentRevision.id,
        actionId: crypto.randomUUID(), expectedVersion: detail.version, actionType: 'signature_captured',
        customerContext: { signerName: customerName, signerRole: customerRole || undefined,
          signerRelationship: customerRelationship, captureMethod: 'Unterschrift auf dem Gerät',
          wordingSnapshot: WORK_ARTIFACT_LEGAL_NOTICE }, signatureDocumentId });
      if (await handleMutationFailure(result, 'Die Unterschrift konnte nicht abgeschlossen werden.')) return;
      await load(detail.id); setSignatureFile(null); setPendingSignatureDocumentId(null);
      showBanner({ variant: 'success', message: 'Unterschrift wurde zur aktuellen Version gespeichert.' });
    });
  }

  async function closeDialog() {
    if (pendingSignatureDocumentId) {
      await discardUnlinkedWorkArtifactSignature(pendingSignatureDocumentId);
      setPendingSignatureDocumentId(null);
    }
    onClose();
  }

  function linkDocument() {
    if (!detail || !currentRevision || !documentId) return;
    startTransition(async () => {
      const result = await linkWorkArtifactDocument({ artifactId: detail.id, revisionId: currentRevision.id,
        linkId: crypto.randomUUID(), expectedVersion: detail.version, documentId, relation: documentRelation });
      if (await handleMutationFailure(result, 'Das Dokument konnte nicht verknüpft werden.')) return;
      await load(detail.id); setDocumentId(''); showBanner({ variant: 'success', message: 'Dokument wurde verknüpft.' });
    });
  }

  function exportArtifact() {
    if (!detail) return;
    startTransition(async () => {
      const result = await exportWorkArtifact({ artifactId: detail.id, expectedVersion: detail.version,
        linkId: crypto.randomUUID(), actionId: crypto.randomUUID(), documentId: crypto.randomUUID() });
      if (await handleMutationFailure(result, 'Der Export konnte nicht erstellt werden.')) return;
      await load(detail.id); showBanner({ variant: 'success', message: 'HTML-Export wurde unter Dokumente abgelegt.' });
    });
  }

  function linkTimeEntry() {
    if (!detail || !currentRevision || !timeEntryId) return;
    startTransition(async () => {
      const result = await linkWorkArtifactSource({ artifactId: detail.id, revisionId: currentRevision.id,
        linkId: crypto.randomUUID(), expectedVersion: detail.version, timeEntryId,
        description: 'Arbeitszeitbezug' });
      if (await handleMutationFailure(result, 'Der Zeiteintrag konnte nicht verknüpft werden.')) return;
      await load(detail.id); setTimeEntryId('');
      showBanner({ variant: 'success', message: 'Zeiteintrag wurde mit dieser Version verknüpft.' });
    });
  }

  function fulfill(requirementId: string) {
    if (!currentRevision) return;
    startTransition(async () => {
      const fulfillmentId = crypto.randomUUID();
      const result = await fulfillInstructionEvidence({ fulfillmentId,
        evidenceRequirementId: requirementId, artifactRevisionId: currentRevision.id });
      if (!result.success) { setError('Die Nachweiserwartung konnte nicht erfüllt werden.'); return; }
      setLocalFulfillments((current) => new Map(current).set(requirementId, { id: fulfillmentId, version: 1 }));
      setRemovedFulfillmentIds((current) => { const next = new Set(current); next.delete(requirementId); return next; });
      showBanner({ variant: 'success', message: 'Nachweiserwartung wurde mit dieser Version erfüllt.' });
    });
  }

  function removeFulfillment(requirement: EvidenceRequirement, fulfillment: { id: string; version: number }) {
    startTransition(async () => {
      const result = await removeInstructionEvidenceFulfillment({ fulfillmentId: fulfillment.id,
        expectedVersion: fulfillment.version, reason: actionReason });
      if (!result.success) { setError('Die Nachweiserfüllung konnte nicht entfernt werden.'); return; }
      setRemovedFulfillmentIds((current) => new Set(current).add(requirement.id));
      setLocalFulfillments((current) => { const next = new Map(current); next.delete(requirement.id); return next; });
      setActionReason('');
      showBanner({ variant: 'success', message: 'Nachweiserfüllung wurde begründet entfernt.' });
    });
  }

  function setVoid() {
    if (!detail) return;
    startTransition(async () => {
      const result = await voidWorkArtifact({ artifactId: detail.id, actionId: crypto.randomUUID(),
        expectedVersion: detail.version, reason: actionReason });
      if (await handleMutationFailure(result, 'Der Arbeitsnachweis konnte nicht ungültig gesetzt werden.')) return;
      await load(detail.id); setActionReason(''); showBanner({ variant: 'success', message: 'Arbeitsnachweis wurde ungültig gesetzt.' });
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isPending) void closeDialog(); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{detail ? currentRevision?.title ?? 'Arbeitsnachweis' : 'Arbeitsnachweis erstellen'}</DialogTitle>
          <DialogDescription>{detail ? `${WORK_ARTIFACT_KIND_LABELS[detail.kind]} · ${WORK_ARTIFACT_STATUS_LABELS[detail.status]} · Version ${currentRevision?.revision_number ?? 1}` : 'Strukturierte Dokumentation direkt dem aktuellen Auftrag oder Projekt zuordnen.'}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5 py-1">
          {hasRemoteUpdate && detail && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <p>Dieser Arbeitsnachweis wurde zwischenzeitlich geändert.</p>
              <Button type="button" size="sm" variant="outline" onClick={async () => {
                await load(detail.id); onRemoteUpdateHandled();
              }}>Aktualisieren</Button>
            </div>
          )}
          {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="size-5 animate-spin" /></div> : editing ? (
            <ArtifactForm kind={kind} setKind={setKind} lockedKind={Boolean(detail)} visibility={visibility}
              setVisibility={setVisibility} title={title} setTitle={setTitle} capturedAt={capturedAt}
              setCapturedAt={setCapturedAt} content={content} patchContent={patchContent}
              measurementLines={measurementLines} setMeasurementLines={(lines) => patchContent({ measurementLines: lines })}
              instructionOptions={instructionOptions}
              requiresCorrectionReason={requiresCorrectionReason} correctionReason={correctionReason}
              setCorrectionReason={setCorrectionReason} />
          ) : detail && currentRevision ? (
            <ArtifactDetail detail={detail} currentRevision={currentRevision} currentUserId={currentUserId} />
          ) : null}

          {!editing && detail && currentRevision && detail.status !== 'voided' && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>Neue Version</Button>
                {detail.status === 'draft' && (
                  <Button type="button" onClick={() => act('review_requested')}>Zur Prüfung einreichen</Button>
                )}
                {detail.status === 'submitted' && canApprove && currentRevision.created_by !== currentUserId && (
                  <><Button type="button" onClick={() => act('internal_approved')} disabled={isPending}>Intern freigeben</Button>
                    <Button type="button" variant="outline" onClick={() => act('correction_requested', actionReason)} disabled={isPending || actionReason.trim().length < 3}>Korrektur anfordern</Button></>
                )}
                {detail.status === 'submitted' && (isManager || detail.actions.some((action) => action.revision_id === currentRevision.id && action.action_type === 'review_requested' && action.created_by === currentUserId)) && (
                  <Button type="button" variant="outline" onClick={() => act('review_withdrawn')} disabled={isPending}>Prüfung zurückziehen</Button>
                )}
                <Button type="button" variant="outline" onClick={exportArtifact} disabled={isPending}><Download className="size-4" />Export</Button>
              </div>
              <div className="space-y-2"><Label htmlFor="artifact-action-reason">Begründung für Ablehnung, Korrektur, Vorbehalt oder Ungültigkeit</Label><Textarea id="artifact-action-reason" value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></div>
              {detail.status === 'submitted' && canApprove && currentRevision.created_by !== currentUserId && (
                <Button type="button" variant="destructive" onClick={() => act('internal_rejected', actionReason)} disabled={isPending || actionReason.trim().length < 3}>Ablehnen</Button>
              )}
              {currentRevision.visibility === 'customer_facing' && (
                <FormDisclosure label="Kundenentscheidung und Unterschrift">
                  <div className="space-y-4 rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">{WORK_ARTIFACT_LEGAL_NOTICE}</p>
                    <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="artifact-customer-name">Name</Label><Input id="artifact-customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></div><div><Label htmlFor="artifact-customer-role">Rolle/Funktion</Label><Input id="artifact-customer-role" value={customerRole} onChange={(event) => setCustomerRole(event.target.value)} /></div></div>
                    <div><Label htmlFor="artifact-customer-relationship">Bezug zum Kunden</Label><Input id="artifact-customer-relationship" value={customerRelationship} onChange={(event) => setCustomerRelationship(event.target.value)} /></div>
                    <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => customerAction('customer_acknowledged')} disabled={isPending || customerName.trim().length < 2}>Bestätigung erfassen</Button><Button type="button" variant="outline" onClick={() => customerAction('customer_reserved')} disabled={isPending || customerName.trim().length < 2 || actionReason.trim().length < 3}>Vorbehalt erfassen</Button><Button type="button" variant="outline" onClick={() => customerAction('customer_refused')} disabled={isPending || customerName.trim().length < 2 || actionReason.trim().length < 3}>Ablehnung erfassen</Button></div>
                    <SignaturePad disabled={isPending || Boolean(pendingSignatureDocumentId)} onChange={setSignatureFile} />
                    {pendingSignatureDocumentId && <p className="text-xs text-muted-foreground">Der Upload ist bereit. Du kannst das Speichern erneut versuchen.</p>}
                    <Button type="button" onClick={captureSignature} disabled={isPending || !signatureFile || customerName.trim().length < 2}>Unterschrift speichern</Button>
                  </div>
                </FormDisclosure>
              )}
              {documents.length > 0 && (
                <FormDisclosure label="Dokument verknüpfen">
                  <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_180px_auto]">
                    <Select value={documentId} onValueChange={setDocumentId}><SelectTrigger aria-label="Dokument auswählen"><SelectValue placeholder="Dokument wählen" /></SelectTrigger><SelectContent>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.displayName}</SelectItem>)}</SelectContent></Select>
                    <Select value={documentRelation} onValueChange={(value) => setDocumentRelation(value as typeof documentRelation)}><SelectTrigger aria-label="Dokumentbezug"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="supporting_evidence">Nachweis</SelectItem><SelectItem value="closure_proof">Abschlussnachweis</SelectItem></SelectContent></Select>
                    <Button type="button" variant="outline" onClick={linkDocument} disabled={isPending || !documentId}>Verknüpfen</Button>
                  </div>
                </FormDisclosure>
              )}
              {timeEntryOptions.length > 0 && (
                <FormDisclosure label="Zeiteintrag verknüpfen">
                  <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto]">
                    <Select value={timeEntryId} onValueChange={setTimeEntryId}><SelectTrigger aria-label="Zeiteintrag auswählen"><SelectValue placeholder="Zeiteintrag wählen" /></SelectTrigger><SelectContent>{timeEntryOptions.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}</SelectContent></Select>
                    <Button type="button" variant="outline" onClick={linkTimeEntry} disabled={isPending || !timeEntryId}>Verknüpfen</Button>
                  </div>
                </FormDisclosure>
              )}
              {evidenceRequirements.length > 0 && (
                <FormDisclosure label="Nachweiserwartung erfüllen">
                  <div className="divide-y rounded-md border">{evidenceRequirements.map((requirement) => { const fulfillment = removedFulfillmentIds.has(requirement.id) ? null : localFulfillments.get(requirement.id) ?? requirement.fulfillment ?? null; return <div key={requirement.id} className="flex items-center justify-between gap-3 p-3"><p className="text-sm">{requirement.description}</p>{fulfillment ? <Button type="button" size="sm" variant="outline" onClick={() => removeFulfillment(requirement, fulfillment)} disabled={isPending || actionReason.trim().length < 3}>Erfüllung entfernen</Button> : <Button type="button" size="sm" variant="outline" onClick={() => fulfill(requirement.id)} disabled={isPending}>{`Mit Version ${currentRevision.revision_number} erfüllen`}</Button>}</div>; })}</div>
                </FormDisclosure>
              )}
              {canVoid && <div className="flex justify-end"><Button type="button" variant="ghost" className="text-destructive" onClick={setVoid} disabled={isPending || actionReason.trim().length < 3}><Trash2 className="size-4" />Ungültig setzen</Button></div>}
            </div>
          )}
          <ErrorText>{error}</ErrorText>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void closeDialog()} disabled={isPending}>Schließen</Button>
          {editing && <><Button type="button" variant="outline" onClick={() => save(false)} disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Als Entwurf speichern</Button><Button type="button" onClick={() => save(true)} disabled={isPending}>Zur Prüfung einreichen</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id: providedId, label, value, onChange, textarea = false }: { id?: string; label: string; value?: string; onChange: (value: string) => void; textarea?: boolean }) {
  const id = providedId ?? `artifact-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{textarea ? <Textarea id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} /> : <Input id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />}</div>;
}

function DateField({ id, label, value, onChange }: { id: string; label: string; value?: string; onChange: (value: string) => void }) {
  const date = value ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) : undefined;
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><DatePicker id={id} value={date} onChange={(next) => onChange(next ? toLocalDateString(next) : '')} ariaLabel={label} /></div>;
}

function ArtifactForm({ kind, setKind, lockedKind, visibility, setVisibility, title, setTitle, capturedAt,
  setCapturedAt, content, patchContent, measurementLines, setMeasurementLines, requiresCorrectionReason,
  correctionReason, setCorrectionReason,
  instructionOptions,
}: {
  kind: WorkArtifactKind; setKind: (value: WorkArtifactKind) => void; lockedKind: boolean;
  visibility: WorkArtifactVisibility; setVisibility: (value: WorkArtifactVisibility) => void;
  title: string; setTitle: (value: string) => void; capturedAt: string; setCapturedAt: (value: string) => void;
  content: WorkArtifactContentInput; patchContent: (patch: Partial<WorkArtifactContentInput>) => void;
  measurementLines: MeasurementLineInput[]; setMeasurementLines: (lines: MeasurementLineInput[]) => void;
  requiresCorrectionReason: boolean; correctionReason: string; setCorrectionReason: (value: string) => void;
  instructionOptions: Array<{ id: string; label: string }>;
}) {
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Art</Label><Select value={kind} disabled={lockedKind} onValueChange={(value) => setKind(value as WorkArtifactKind)}><SelectTrigger aria-label="Art des Arbeitsnachweises"><SelectValue /></SelectTrigger><SelectContent>{WORK_ARTIFACT_KINDS.map((value) => <SelectItem key={value} value={value}>{WORK_ARTIFACT_KIND_LABELS[value]}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Sichtbarkeit</Label><Select value={visibility} onValueChange={(value) => setVisibility(value as WorkArtifactVisibility)}><SelectTrigger aria-label="Sichtbarkeit des Arbeitsnachweises"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="internal_only">Nur intern</SelectItem><SelectItem value="customer_facing">Für Kundendokumentation</SelectItem></SelectContent></Select></div></div>
    <Field label="Titel" value={title} onChange={setTitle} />
    <div className="space-y-2"><Label>Erfasst am</Label><DateTimeField value={capturedAt} onChange={setCapturedAt} idPrefix="artifact-captured" dateAriaLabel="Erfassungsdatum" /></div>
    <Field label="Zusammenfassung" value={content.summary} onChange={(value) => patchContent({ summary: value })} textarea />
    {instructionOptions.length > 0 && <div className="space-y-2"><Label>Zugehörige Aufgabe/Checkliste</Label><Select value={content.instructionItemId ?? '__none__'} onValueChange={(value) => patchContent({ instructionItemId: value === '__none__' ? undefined : value })}><SelectTrigger aria-label="Zugehörige Aufgabe oder Checkliste"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Keine direkte Zuordnung</SelectItem>{instructionOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></div>}
    {kind === 'site_diary' && <div className="grid gap-4"><DateField id="artifact-work-date" label="Arbeitstag" value={content.workDate} onChange={(value) => patchContent({ workDate: value })} /><Field label="Fortschritt" value={content.progress} onChange={(value) => patchContent({ progress: value })} textarea /><Field label="Anwesende Personen" value={content.peoplePresent} onChange={(value) => patchContent({ peoplePresent: value })} /><Field label="Wetter" value={content.weatherConditions} onChange={(value) => patchContent({ weatherConditions: value })} /><Field label="Bedingungen vor Ort" value={content.siteConditions} onChange={(value) => patchContent({ siteConditions: value })} textarea /><Field label="Lieferungen" value={content.deliveries} onChange={(value) => patchContent({ deliveries: value })} textarea /><Field label="Behinderungen" value={content.impediments} onChange={(value) => patchContent({ impediments: value })} textarea /><Field label="Entscheidungen" value={content.decisions} onChange={(value) => patchContent({ decisions: value })} textarea /><Field label="Besondere Ereignisse" value={content.notableEvents} onChange={(value) => patchContent({ notableEvents: value })} textarea /></div>}
    {kind === 'work_report' && <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Beginn</Label><DateTimeField value={content.visitStartedAt ?? ''} onChange={(value) => patchContent({ visitStartedAt: value })} idPrefix="artifact-visit-start" /></div><div className="space-y-2"><Label>Ende</Label><DateTimeField value={content.visitEndedAt ?? ''} onChange={(value) => patchContent({ visitEndedAt: value })} idPrefix="artifact-visit-end" /></div></div><Field label="Ausgeführte Arbeiten" value={content.performedWork} onChange={(value) => patchContent({ performedWork: value })} textarea /><Field label="Offene Arbeiten" value={content.outstandingWork} onChange={(value) => patchContent({ outstandingWork: value })} textarea /><Field label="Materialhinweise" value={content.materialsSummary} onChange={(value) => patchContent({ materialsSummary: value })} textarea /><div className="space-y-2"><Label>Nächster Besuch</Label><DateTimeField value={content.nextVisitAt ?? ''} onChange={(value) => patchContent({ nextVisitAt: value })} idPrefix="artifact-next-visit" /></div></div>}
    {kind === 'measurement' && <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><DateField id="artifact-measurement-date" label="Aufmaßdatum" value={content.measurementDate} onChange={(value) => patchContent({ measurementDate: value })} /><Field label="Aufmaßort" value={content.measurementLocation} onChange={(value) => patchContent({ measurementLocation: value })} /></div><Field label="Aufmaßhinweise" value={content.measurementNotes} onChange={(value) => patchContent({ measurementNotes: value })} textarea /><div className="space-y-3"><div className="flex items-center justify-between"><Label>Positionen</Label><Button type="button" size="sm" variant="ghost" onClick={() => setMeasurementLines([...measurementLines, { description: '', quantity: '1', unit: 'piece' }])}>Position ergänzen</Button></div>{measurementLines.map((line, index) => <div key={line.id ?? index} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_180px_auto]"><Field id={`artifact-measurement-description-${index}`} label="Bezeichnung" value={line.description} onChange={(value) => setMeasurementLines(measurementLines.map((entry, current) => current === index ? { ...entry, description: value } : entry))} /><div className="space-y-2"><Label htmlFor={`artifact-measurement-quantity-${index}`}>Menge</Label><QuantityStepper id={`artifact-measurement-quantity-${index}`} value={line.quantity} onChange={(value) => setMeasurementLines(measurementLines.map((entry, current) => current === index ? { ...entry, quantity: value } : entry))} min={0.001} step={1} unitLabel={WORK_ARTIFACT_UNIT_LABELS[line.unit]} /></div><Button type="button" size="icon" variant="ghost" className="self-end" onClick={() => setMeasurementLines(measurementLines.filter((_, current) => current !== index))} aria-label="Aufmaßposition entfernen"><Trash2 className="size-4" /></Button><Select value={line.unit} onValueChange={(value) => setMeasurementLines(measurementLines.map((entry, current) => current === index ? { ...entry, unit: value as MeasurementLineInput['unit'] } : entry))}><SelectTrigger aria-label="Aufmaßeinheit"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(WORK_ARTIFACT_UNIT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Field id={`artifact-measurement-location-${index}`} label="Ort" value={line.location} onChange={(value) => setMeasurementLines(measurementLines.map((entry, current) => current === index ? { ...entry, location: value } : entry))} /></div>)}</div></div>}
    {kind === 'defect' && <div className="space-y-4"><Field label="Mangelbeschreibung" value={content.defectDescription} onChange={(value) => patchContent({ defectDescription: value })} textarea /><div className="grid gap-4 sm:grid-cols-2"><Field id="artifact-defect-location" label="Ort" value={content.defectLocation} onChange={(value) => patchContent({ defectLocation: value })} /><div className="space-y-2"><Label>Schweregrad</Label><Select value={content.defectSeverity ?? 'medium'} onValueChange={(value) => patchContent({ defectSeverity: value as WorkArtifactContentInput['defectSeverity'] })}><SelectTrigger aria-label="Schweregrad"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Niedrig</SelectItem><SelectItem value="medium">Mittel</SelectItem><SelectItem value="high">Hoch</SelectItem><SelectItem value="critical">Kritisch</SelectItem></SelectContent></Select></div><DateField id="artifact-due-date" label="Fällig am" value={content.dueDate} onChange={(value) => patchContent({ dueDate: value })} /><div className="space-y-2"><Label>Status</Label><Select value={content.defectState ?? 'open'} onValueChange={(value) => patchContent({ defectState: value as WorkArtifactContentInput['defectState'] })}><SelectTrigger aria-label="Mangelstatus"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Offen</SelectItem><SelectItem value="in_progress">In Bearbeitung</SelectItem><SelectItem value="resolved">Behoben</SelectItem></SelectContent></Select></div></div><Field label="Zuständigkeit" value={content.responsibilityContext} onChange={(value) => patchContent({ responsibilityContext: value })} /><Field label="Vorgeschlagene Lösung" value={content.proposedResolution} onChange={(value) => patchContent({ proposedResolution: value })} textarea />{content.defectState === 'resolved' && <Field label="Behebung" value={content.resolutionSummary} onChange={(value) => patchContent({ resolutionSummary: value })} textarea />}</div>}
    {kind === 'change_work' && <div className="space-y-4"><Field label="Änderungs-/Regiearbeit" value={content.changeDescription} onChange={(value) => patchContent({ changeDescription: value })} textarea /><Field label="Grund" value={content.changeReason} onChange={(value) => patchContent({ changeReason: value })} textarea /><Field label="Angefordert durch" value={content.requestedByContext} onChange={(value) => patchContent({ requestedByContext: value })} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Erwartete Arbeitsminuten" value={content.expectedLaborMinutes} onChange={(value) => patchContent({ expectedLaborMinutes: value })} /><Field label="Tatsächliche Arbeitsminuten" value={content.actualLaborMinutes} onChange={(value) => patchContent({ actualLaborMinutes: value })} /></div><Field label="Erwartetes Material" value={content.expectedMaterialSummary} onChange={(value) => patchContent({ expectedMaterialSummary: value })} textarea /><Field label="Tatsächliches Material" value={content.actualMaterialSummary} onChange={(value) => patchContent({ actualMaterialSummary: value })} textarea /><div className="space-y-2"><Label>Autorisierungsstand</Label><Select value={content.authorizationState ?? 'not_requested'} onValueChange={(value) => patchContent({ authorizationState: value as WorkArtifactContentInput['authorizationState'] })}><SelectTrigger aria-label="Autorisierungsstand"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not_requested">Nicht angefragt</SelectItem><SelectItem value="requested">Angefragt</SelectItem><SelectItem value="authorized">Autorisiert</SelectItem><SelectItem value="rejected">Abgelehnt</SelectItem></SelectContent></Select></div><Field label="Terminauswirkung" value={content.scheduleImpact} onChange={(value) => patchContent({ scheduleImpact: value })} textarea /></div>}
    {visibility === 'customer_facing' && <div className="space-y-3 rounded-md border p-4"><Field label="Kundenaussage" value={content.customerStatement} onChange={(value) => patchContent({ customerStatement: value })} textarea /><label className="flex items-center gap-2 text-sm"><Checkbox checked={content.requiresCustomerResponse ?? false} onCheckedChange={(checked) => patchContent({ requiresCustomerResponse: checked === true })} />Kundenentscheidung erforderlich</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={content.requiresSignature ?? false} onCheckedChange={(checked) => patchContent({ requiresSignature: checked === true })} />Unterschrift erforderlich</label></div>}
    {requiresCorrectionReason && <Field label="Grund der neuen Version" value={correctionReason} onChange={setCorrectionReason} textarea />}
  </div>;
}

function ArtifactDetail({ detail, currentRevision, currentUserId }: { detail: WorkArtifactDetail; currentRevision: WorkArtifactDetail['revisions'][number]; currentUserId: string }) {
  const defect = detail.defectDetails.find((entry) => entry.revision_id === currentRevision.id);
  const change = detail.changeDetails.find((entry) => entry.revision_id === currentRevision.id);
  const fields = [
    ['Zusammenfassung', currentRevision.summary], ['Fortschritt', currentRevision.progress],
    ['Ausgeführte Arbeiten', currentRevision.performed_work], ['Offene Arbeiten', currentRevision.outstanding_work],
    ['Material', currentRevision.materials_summary], ['Kundenaussage', currentRevision.customer_statement],
    ['Aufmaßort', currentRevision.measurement_location], ['Hinweise', currentRevision.measurement_notes],
    ['Mangelbeschreibung', defect?.description], ['Schweregrad', defect?.severity],
    ['Mangelort', defect?.location], ['Fällig am', defect?.due_date], ['Mangelstatus', defect?.state],
    ['Zuständigkeit', defect?.responsibility_context], ['Vorgeschlagene Lösung', defect?.proposed_resolution],
    ['Behebung', defect?.resolution_summary], ['Änderungs-/Regiearbeit', change?.change_description],
    ['Änderungsgrund', change?.change_reason], ['Angefordert durch', change?.requested_by_context],
    ['Erwartete Arbeitsminuten', change?.expected_labor_minutes], ['Tatsächliche Arbeitsminuten', change?.actual_labor_minutes],
    ['Erwartetes Material', change?.expected_material_summary], ['Tatsächliches Material', change?.actual_material_summary],
    ['Autorisierungsstand', change?.authorization_state], ['Terminauswirkung', change?.schedule_impact],
  ].filter(([, value]) => value);
  return <div className="space-y-5">
    <div className="grid gap-3 rounded-md border bg-muted/20 p-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Erfasst am</p><p className="text-sm">{displayDateTime(currentRevision.captured_at)}</p></div><div><p className="text-xs text-muted-foreground">Sichtbarkeit</p><p className="text-sm">{currentRevision.visibility === 'customer_facing' ? 'Kundendokumentation' : 'Nur intern'}</p></div></div>
    {fields.map(([label, value]) => <div key={label}><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm">{value}</p></div>)}
    {detail.measurementLines.filter((line) => line.revision_id === currentRevision.id).length > 0 && <div className="overflow-hidden rounded-md border"><div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-muted/40 px-3 py-2 text-xs font-medium"><span>Position</span><span>Menge</span><span>Einheit</span></div>{detail.measurementLines.filter((line) => line.revision_id === currentRevision.id).map((line) => <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-2 border-t px-3 py-2 text-sm"><span>{line.description}</span><span className="tabular-nums">{line.quantity}</span><span>{WORK_ARTIFACT_UNIT_LABELS[line.unit]}</span></div>)}</div>}
    {detail.documents.filter((document) => document.revision_id === currentRevision.id).length > 0 && <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Verknüpfte Dokumente</p><div className="mt-2 divide-y rounded-md border">{detail.documents.filter((document) => document.revision_id === currentRevision.id).map((document) => <p key={document.id} className="p-3 text-sm">{DOCUMENT_RELATION_LABELS[document.relation]} · {document.description ?? document.document_id}</p>)}</div></div>}
    {detail.sources.filter((source) => source.revision_id === currentRevision.id).length > 0 && <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quellen</p><div className="mt-2 divide-y rounded-md border">{detail.sources.filter((source) => source.revision_id === currentRevision.id).map((source) => <p key={source.id} className="p-3 text-sm">{source.time_entry_id ? 'Zeiteintrag' : 'Bestandsbewegung'} · {source.description ?? source.time_entry_id ?? source.inventory_movement_id}</p>)}</div></div>}
    <FormDisclosure label={`Verlauf (${detail.revisions.length} Versionen, ${detail.actions.length} Aktionen)`}>
      <div className="space-y-3"><div className="divide-y rounded-md border">{detail.revisions.map((revision) => <div key={revision.id} className="p-3 text-sm"><p className="font-medium">Version {revision.revision_number} · {revision.title}</p><p className="text-xs text-muted-foreground">{displayDateTime(revision.created_at)}{revision.created_by === currentUserId ? ' · von dir' : ''}{revision.correction_reason ? ` · ${revision.correction_reason}` : ''}</p></div>)}</div>{detail.actions.length > 0 && <div className="divide-y rounded-md border">{detail.actions.map((action) => <div key={action.id} className="p-3 text-sm"><p className="font-medium">{ACTION_LABELS[action.action_type] ?? action.action_type}</p><p className="text-xs text-muted-foreground">{displayDateTime(action.created_at)}{action.signer_name ? ` · ${action.signer_name}` : ''}{action.reason ? ` · ${action.reason}` : ''}</p></div>)}</div>}</div>
    </FormDisclosure>
  </div>;
}
