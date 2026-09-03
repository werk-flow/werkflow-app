'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Download, Eye, Loader2, RotateCcw, Save } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorText } from '@/components/ui/error-text';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePendingTask } from '@/hooks/use-server-action';
import { getDocumentSignedUrl } from '@/lib/documents/actions';
import {
  previewWorkHandover,
  releaseWorkHandover,
  returnWorkHandoverForCorrection,
  saveWorkHandoverDraft,
  withdrawWorkHandover,
} from '@/lib/work-handover/actions';
import {
  WORK_HANDOVER_READINESS_LABELS,
  WORK_HANDOVER_STATE_LABELS,
  type WorkHandoverFieldStatus,
  type WorkHandoverWorkspace,
} from '@/lib/work-handover/types';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Bitte prüfe die Eingaben.',
  work_handover_not_authorized: 'Du bist für diese Übergabe nicht zuständig.',
  work_handover_target_not_found: 'Die Übergabe wurde nicht gefunden.',
  work_handover_target_load_failed: 'Auftrags- und Kundendaten konnten nicht geladen werden.',
  work_handover_sources_load_failed: 'Die auswählbaren Inhalte konnten nicht geladen werden.',
  work_handover_workspace_load_failed: 'Der Übergabestand konnte nicht geladen werden.',
  work_handover_summary_load_failed: 'Zeit- und Materialdaten konnten nicht geladen werden.',
  work_handover_stale_version: 'Die Übergabe wurde inzwischen geändert. Die Seite wird aktualisiert.',
  work_handover_execution_state_invalid: 'Die Ausführung muss zuerst abgeschlossen sein.',
  work_handover_source_stale: 'Eine ausgewählte Quelle wurde inzwischen geändert. Bitte prüfe die Auswahl erneut.',
  work_handover_package_empty: 'Wähle mindestens einen freigegebenen Inhalt aus.',
  work_handover_gate_stale: 'Die Abschlussprüfung hat sich geändert. Bitte prüfe sie erneut.',
  work_handover_gate_snapshot_invalid: 'Die Abschlussprüfung ist unvollständig. Lade die Seite erneut.',
  work_handover_active_clock: 'Für diesen Auftrag läuft noch eine Zeiterfassung.',
  work_handover_review_blocked: 'Offene Prüfpunkte benötigen eine begründete Ausnahme.',
  work_handover_override_reason_required: 'Bitte begründe die Ausnahme nachvollziehbar.',
  work_handover_override_not_needed: 'Es gibt derzeit keinen Prüfschritt, der eine Ausnahme benötigt.',
  work_handover_release_state_invalid: 'Der Übergabestand passt nicht zu dieser Aktion. Die Seite wird aktualisiert.',
  work_handover_preview_stale: 'Der Inhalt hat sich seit der Vorschau geändert. Erstelle eine neue Vorschau.',
  work_handover_sources_overflow: 'Für diese Übergabe sind zu viele Quellen verknüpft. Bitte bereinige die Zuordnung.',
  work_handover_summary_overflow: 'Für diese Übergabe sind zu viele Zeit- oder Materialbuchungen verknüpft.',
  work_handover_action_failed: 'Die Übergabe konnte nicht gespeichert werden.',
};

const OVERRIDEABLE_GATES: Array<[string, string]> = [
  ['incompleteRequiredInstructions', 'Pflichtanweisungen offen'],
  ['reopenedInstructionPredecessors', 'Vorgänger erneut offen'],
  ['incompleteInstructionEvidence', 'Pflichtnachweise fehlen'],
  ['openBlockers', 'Blocker offen'],
  ['openCompletionDependencies', 'Abschlussvoraussetzungen offen'],
  ['incompleteProjectChildren', 'Untergeordnete Aufträge nicht abgeschlossen'],
  ['incompleteChildHandovers', 'Untergeordnete Übergaben fehlen'],
  ['openDefects', 'Mängel offen'],
  ['pendingFormalApprovals', 'Freigaben ausstehend'],
  ['requiredCustomerDecisions', 'Kundenentscheidung ausstehend'],
  ['requiredSignatures', 'Unterschrift ausstehend'],
];

const WARNING_GATES: Array<[string, string]> = [
  ['missingOptionalPhotos', 'Keine optionalen Fotos ausgewählt oder verknüpft'],
  ['missingDispatchContext', 'Kein Einsatzauftrag vorhanden'],
  ['missingTimeContext', 'Keine Zeitbuchung vorhanden'],
  ['missingMaterialContext', 'Kein Materialkontext vorhanden'],
];

const UNASSESSED_FACT_LABELS: Record<string, string> = {
  time_segment_completeness: 'Vollständigkeit der Zeitsegmente',
  material_consumption: 'Materialverbrauch',
  tool_custody: 'Werkzeugverbleib',
  measurements: 'Vollständigkeit der Aufmaße',
  customer_decision: 'Kundenentscheidung',
  signature: 'Unterschrift',
  billability: 'Abrechenbarkeit',
  invoice_readiness: 'Rechnungsreife',
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}

function gateCount(snapshot: WorkHandoverWorkspace['gateSnapshot'], key: string): number {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 0;
  const value = snapshot[key];
  return typeof value === 'number' ? value : 0;
}

function unassessedFacts(snapshot: WorkHandoverWorkspace['gateSnapshot']): string[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const value = snapshot.notAssessable;
  return Array.isArray(value)
    ? value.flatMap((entry) => (
        typeof entry === 'string' && UNASSESSED_FACT_LABELS[entry]
          ? [UNASSESSED_FACT_LABELS[entry]]
          : []
      ))
    : [];
}

function renderHtmlPreview(previewWindow: Window, html: string): void {
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  previewWindow.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
  previewWindow.location.replace(blobUrl);
}

async function openDocument(documentId: string): Promise<string | null> {
  const documentWindow = window.open('about:blank', '_blank');
  if (!documentWindow) {
    return 'Der Browser hat das Fenster blockiert. Erlaube Pop-ups und versuche es erneut.';
  }
  documentWindow.opener = null;
  const result = await getDocumentSignedUrl(documentId);
  if (!result.success) {
    documentWindow.close();
    return 'Das Übergabedokument konnte nicht geöffnet werden.';
  }
  documentWindow.location.replace(result.signedUrl);
  return null;
}

export function WorkHandoverSection({
  initialWorkspace,
}: {
  initialWorkspace: WorkHandoverWorkspace;
}): ReactElement {
  const router = useRouter();
  const [selectedKeys, setSelectedKeys] = useState(initialWorkspace.selectedSourceKeys);
  const [localPackageVersion, setLocalPackageVersion] = useState({
    base: initialWorkspace.packageVersion,
    value: initialWorkspace.packageVersion,
  });
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('Ausführung geprüft und vollständig an das Büro übergeben.');
  const [overrideReason, setOverrideReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [preview, setPreview] = useState<{
    releaseId: string;
    requestId: string;
    documentId: string;
    documentLinkId: string;
    contentHash: string;
    packageVersion: number;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run: runHandoverTask, isPending: pending } = usePendingTask();
  const workspaceAuthorityIdentity = JSON.stringify({
    targetId: initialWorkspace.targetId,
    executionVersion: initialWorkspace.executionVersion,
    packageState: initialWorkspace.packageState,
    packageVersion: initialWorkspace.packageVersion,
    selectedSourceKeys: initialWorkspace.selectedSourceKeys,
  });
  useEffect(() => {
    setSelectedKeys(initialWorkspace.selectedSourceKeys);
    setLocalPackageVersion({
      base: initialWorkspace.packageVersion,
      value: initialWorkspace.packageVersion,
    });
    setDirty(false);
    // A preview stays valid when the fresh authoritative props confirm the
    // exact package version it was created against — a route refresh landing
    // right after the save (whose bump the client already adopted) must not
    // permanently disable the release button. Any other version change
    // invalidates the preview as before.
    setPreview((current) =>
      current && current.packageVersion === initialWorkspace.packageVersion
        ? current
        : null
    );
    // This key represents every authoritative prop read above. Keeping typed
    // reasons outside the reset avoids losing reviewer input on refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceAuthorityIdentity]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const overrideable = useMemo(() => OVERRIDEABLE_GATES.flatMap(([key, label]) => {
    const count = gateCount(initialWorkspace.gateSnapshot, key);
    return count > 0 ? [{ key, label, count }] : [];
  }), [initialWorkspace.gateSnapshot]);
  const warnings = useMemo(() => WARNING_GATES.flatMap(([key, label]) => (
    gateCount(initialWorkspace.gateSnapshot, key) > 0 ? [label] : []
  )), [initialWorkspace.gateSnapshot]);
  const activeClocks = gateCount(initialWorkspace.gateSnapshot, 'activeJobClocks');
  const packageVersion = localPackageVersion.base === initialWorkspace.packageVersion
    ? localPackageVersion.value
    : initialWorkspace.packageVersion;
  const canEdit = initialWorkspace.executionState === 'execution_complete'
    && initialWorkspace.packageState !== 'released';
  const canPreview = canEdit && packageVersion > 0 && !dirty && selectedKeys.length > 0;

  const refreshAfterMutation = (): void => {
    router.refresh();
  };

  const saveDraft = (): void => {
    setError(null);
    setMessage(null);
    void runHandoverTask(async () => {
      const result = await saveWorkHandoverDraft({
        targetType: initialWorkspace.targetType,
        targetId: initialWorkspace.targetId,
        packageId: initialWorkspace.packageId,
        expectedPackageVersion: packageVersion,
        requestId: crypto.randomUUID(),
        selectedSourceKeys: selectedKeys,
      });
      if (!result.success) {
        setError(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.work_handover_action_failed);
        if (result.error.includes('stale')) refreshAfterMutation();
        return;
      }
      setLocalPackageVersion({ base: packageVersion, value: result.packageVersion });
      setDirty(false);
      setPreview(null);
      setMessage('Entwurf gespeichert.');
      refreshAfterMutation();
    });
  };

  const createPreview = (): void => {
    setError(null);
    setMessage(null);
    const previewWindow = window.open('about:blank', '_blank');
    if (!previewWindow) {
      setError('Der Browser hat die Vorschau blockiert. Erlaube Pop-ups und versuche es erneut.');
      return;
    }
    previewWindow.opener = null;
    previewWindow.document.title = 'Übergabepaket wird erstellt';
    previewWindow.document.body.textContent = 'Vorschau wird erstellt…';
    const identity = {
      releaseId: crypto.randomUUID(), requestId: crypto.randomUUID(),
      documentId: crypto.randomUUID(), documentLinkId: crypto.randomUUID(),
    };
    void runHandoverTask(async () => {
      const result = await previewWorkHandover({
        targetType: initialWorkspace.targetType,
        targetId: initialWorkspace.targetId,
        packageId: initialWorkspace.packageId,
        expectedPackageVersion: packageVersion,
        releaseId: identity.releaseId,
      });
      if (!result.success) {
        previewWindow.close();
        setError(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.work_handover_action_failed);
        if (result.error.includes('stale')) refreshAfterMutation();
        return;
      }
      setPreview({ ...identity, contentHash: result.contentHash, packageVersion });
      renderHtmlPreview(previewWindow, result.html);
      setMessage('Vorschau erstellt. Prüfe das geöffnete Dokument vor der Freigabe.');
    });
  };

  const release = (): void => {
    if (!preview || preview.packageVersion !== packageVersion) return;
    setError(null);
    setMessage(null);
    void runHandoverTask(async () => {
      const result = await releaseWorkHandover({
        targetType: initialWorkspace.targetType,
        targetId: initialWorkspace.targetId,
        packageId: initialWorkspace.packageId,
        expectedPackageVersion: packageVersion,
        expectedExecutionVersion: initialWorkspace.executionVersion,
        releaseId: preview.releaseId,
        requestId: preview.requestId,
        documentId: preview.documentId,
        documentLinkId: preview.documentLinkId,
        expectedContentHash: preview.contentHash,
        reason,
        overrideGates: overrideable.length > 0,
        overrideReason: overrideable.length > 0 ? overrideReason : undefined,
      });
      if (!result.success) {
        setError(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.work_handover_action_failed);
        if (result.error.includes('stale')) refreshAfterMutation();
        return;
      }
      setMessage('Übergabepaket freigegeben und an das Büro übergeben.');
      setPreview(null);
      refreshAfterMutation();
    });
  };

  const reopen = (operation: 'withdraw' | 'correction'): void => {
    setError(null);
    setMessage(null);
    void runHandoverTask(async () => {
      const action = operation === 'withdraw'
        ? withdrawWorkHandover
        : returnWorkHandoverForCorrection;
      const result = await action({
        targetType: initialWorkspace.targetType,
        targetId: initialWorkspace.targetId,
        packageId: initialWorkspace.packageId,
        requestId: crypto.randomUUID(),
        expectedPackageVersion: packageVersion,
        expectedExecutionVersion: initialWorkspace.executionVersion,
        reason: reopenReason,
      });
      if (!result.success) {
        setError(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.work_handover_action_failed);
        return;
      }
      setMessage(operation === 'withdraw'
        ? 'Übergabe zurückgenommen. Ein neuer Entwurf kann vorbereitet werden.'
        : 'Ausführung zur Korrektur geöffnet.');
      refreshAfterMutation();
    });
  };

  return (
    <Card className="border shadow-xs" data-testid="work-handover-section">
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Übergabe an das Büro</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Kundenfähige Inhalte auswählen, prüfen und als unveränderliche Freigabe sichern.
            </p>
          </div>
          <Badge variant={initialWorkspace.packageState === 'released' ? 'default' : 'secondary'}>
            {WORK_HANDOVER_STATE_LABELS[initialWorkspace.packageState]}
          </Badge>
        </div>

        {initialWorkspace.commercialReadiness && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />
            {WORK_HANDOVER_READINESS_LABELS[initialWorkspace.commercialReadiness]}
          </div>
        )}

        {initialWorkspace.staleSourceCount > 0 && (
          <p className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-200">
            {initialWorkspace.staleSourceCount === 1
              ? 'Eine gespeicherte Quelle ist nicht mehr aktuell und wird beim nächsten Speichern entfernt.'
              : `${initialWorkspace.staleSourceCount} gespeicherte Quellen sind nicht mehr aktuell und werden beim nächsten Speichern entfernt.`}
          </p>
        )}

        {canEdit ? (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Inhalte der nächsten Freigabe</h3>
              <p className="text-sm text-muted-foreground">
                Arbeitsnachweise sind intern freigegeben. Dokumente müssen für das Kundenpaket bewusst ausgewählt werden.
              </p>
            </div>
            {initialWorkspace.availableSources.length > 0 ? (
              <div className="divide-y rounded-md border">
                {initialWorkspace.availableSources.map((source) => {
                  const inputId = `handover-source-${source.key.replace(/[^a-zA-Z0-9]/g, '-')}`;
                  return (
                    <div key={source.key} className="flex items-start gap-3 p-3">
                      <Checkbox
                        id={inputId}
                        checked={selectedKeySet.has(source.key)}
                        onCheckedChange={(checked) => {
                          setSelectedKeys((current) => checked
                            ? [...current, source.key]
                            : current.filter((key) => key !== source.key));
                          setDirty(true);
                          setPreview(null);
                        }}
                      />
                      <Label htmlFor={inputId} className="min-w-0 cursor-pointer font-normal">
                        <span className="block font-medium">{source.label}</span>
                        <span className="block text-muted-foreground">{source.description}</span>
                      </Label>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                Es gibt noch keine freigegebenen kundenfähigen Nachweise, Dokumentversionen oder Auftragsübergaben.
              </p>
            )}
            <Button type="button" variant="outline" onClick={saveDraft} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />}
              Entwurf speichern
            </Button>
          </div>
        ) : initialWorkspace.packageState !== 'released' ? (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            Die Ausführung muss abgeschlossen sein, bevor das Büro die Übergabe prüfen kann.
          </p>
        ) : null}

        {canEdit && packageVersion > 0 && (
          <div className="space-y-4 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3 text-sm">
                <span className="font-medium">Harte Prüfung</span>
                <p className={activeClocks > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                  {activeClocks === 1
                    ? 'Eine laufende Zeiterfassung'
                    : activeClocks > 1
                      ? `${activeClocks} laufende Zeiterfassungen`
                      : 'Keine laufende Zeiterfassung'}
                </p>
              </div>
              <div className="rounded-md border p-3 text-sm">
                <span className="font-medium">Prüfpunkte</span>
                <p className="text-muted-foreground">
                  {overrideable.length === 0 ? 'Keine offene Ausnahme' : `${overrideable.length} begründbare Ausnahme(n)`}
                </p>
              </div>
            </div>
            {overrideable.length > 0 && (
              <div className="space-y-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm dark:border-yellow-900 dark:bg-yellow-950/30">
                <p className="font-medium">Offene Prüfpunkte</p>
                <ul className="list-disc space-y-1 pl-5">
                  {overrideable.map((gate) => <li key={gate.key}>{gate.label}: {gate.count}</li>)}
                </ul>
                <Field label="Begründung der Ausnahme" htmlFor="handover-override-reason" required>
                  <Textarea value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="Warum kann die kaufmännische Prüfung trotzdem beginnen?" />
                </Field>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Hinweise</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}
            <Field label="Übergabevermerk" htmlFor="handover-reason" required>
              <Textarea value={reason}
                onChange={(event) => setReason(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={createPreview}
                disabled={pending || !canPreview || activeClocks > 0}>
                {pending ? <Loader2 className="animate-spin" /> : <Eye />}
                Vorschau öffnen
              </Button>
              <Button type="button" onClick={release}
                disabled={pending || !preview || preview.packageVersion !== packageVersion || activeClocks > 0
                  || (overrideable.length > 0 && overrideReason.trim().length < 3)
                  || reason.trim().length < 3}>
                {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                Freigeben und übergeben
              </Button>
            </div>
            {dirty && <p className="text-sm text-muted-foreground">Speichere die Auswahl, bevor du die Vorschau erstellst.</p>}
            {unassessedFacts(initialWorkspace.gateSnapshot).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Nicht automatisch bewertet: {unassessedFacts(initialWorkspace.gateSnapshot).join(', ')}.
              </p>
            )}
          </div>
        )}

        {initialWorkspace.packageState === 'released' && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {initialWorkspace.currentReleaseNumber
                  ? `Freigabe ${initialWorkspace.currentReleaseNumber}`
                  : 'Freigegeben'}
              </span>
              {initialWorkspace.currentReleaseDocumentId && (
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  const openPromise = openDocument(initialWorkspace.currentReleaseDocumentId!);
                  void runHandoverTask(async () => {
                    const downloadError = await openPromise;
                    if (downloadError) setError(downloadError);
                  });
                }} disabled={pending}>
                  <Download /> Dokument herunterladen
                </Button>
              )}
            </div>
            <Field label="Grund für die Rücknahme" htmlFor="handover-withdraw-reason" required>
              <Textarea value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                placeholder="Was muss in einer neuen Freigabe korrigiert werden?" />
            </Field>
            <Button type="button" variant="outline" onClick={() => reopen('withdraw')}
              disabled={pending || reopenReason.trim().length < 3}>
              <RotateCcw /> Übergabe zurücknehmen
            </Button>
          </div>
        )}

        {initialWorkspace.packageState === 'reopened'
          && initialWorkspace.executionState === 'execution_complete' && (
          <div className="space-y-2 border-t pt-4">
            <Field label="Ausführung erneut öffnen" htmlFor="handover-correction-reason" required>
              <Textarea value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                placeholder="Welche Korrektur ist vor Ort erforderlich?" />
            </Field>
            <Button type="button" variant="outline" onClick={() => reopen('correction')}
              disabled={pending || reopenReason.trim().length < 3}>
              <RotateCcw /> Zur Korrektur in Ausführung geben
            </Button>
          </div>
        )}

        {initialWorkspace.releases.length > 0 && (
          <FormDisclosure
            className="border-t pt-4 text-sm"
            label={`Freigabeverlauf (${initialWorkspace.releases.length})`}
          >
            <ul className="mt-3 space-y-2">
              {initialWorkspace.releases.map((releaseEntry) => (
                <li key={releaseEntry.id} className="flex flex-wrap justify-between gap-2 rounded-md border p-3">
                  <span>Freigabe {releaseEntry.release_number} · {WORK_HANDOVER_READINESS_LABELS[releaseEntry.commercial_readiness]}</span>
                  <span className="text-muted-foreground">{formatDateTime(releaseEntry.reviewed_at)}</span>
                </li>
              ))}
            </ul>
          </FormDisclosure>
        )}

        {message && <p role="status" className="text-sm text-green-700 dark:text-green-400">{message}</p>}
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Card>
  );
}

export function WorkHandoverSummary({
  workspace,
  href,
}: {
  workspace: WorkHandoverWorkspace;
  href: string;
}): ReactElement {
  const actionLabel = workspace.packageState === 'released'
    ? 'Übergabe ansehen'
    : workspace.executionState === 'execution_complete'
      ? 'Übergabe prüfen'
      : 'Übergabestand ansehen';
  return (
    <Card className="border shadow-xs" data-testid="work-handover-summary">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Übergabe an das Büro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {WORK_HANDOVER_STATE_LABELS[workspace.packageState]}
            {workspace.currentReleaseNumber ? ` · Freigabe ${workspace.currentReleaseNumber}` : ''}
          </p>
        </div>
        <Button asChild variant={workspace.executionState === 'execution_complete' ? 'default' : 'outline'}>
          <Link href={href}>{actionLabel}</Link>
        </Button>
      </div>
    </Card>
  );
}

export function FieldWorkHandoverStatus({
  status,
}: {
  status: WorkHandoverFieldStatus;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const { run: runDocumentTask, isPending: pending } = usePendingTask();
  return (
    <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5" aria-labelledby="field-handover-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="field-handover-heading" className="font-semibold">Übergabestand</h2>
          <p className="mt-1 text-sm text-muted-foreground">{WORK_HANDOVER_STATE_LABELS[status.state]}</p>
        </div>
        {status.releaseNumber && <Badge variant="secondary">Freigabe {status.releaseNumber}</Badge>}
      </div>
      {status.documentId && (
        <Button type="button" size="sm" variant="outline" className="mt-3"
          disabled={pending} onClick={() => {
            const openPromise = openDocument(status.documentId!);
            void runDocumentTask(async () => setError(await openPromise));
          }}>
          {pending ? <Loader2 className="animate-spin" /> : <Download />}
          Übergabedokument
        </Button>
      )}
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </section>
  );
}
