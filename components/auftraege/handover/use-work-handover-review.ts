'use client';

import { useMemo, useState } from 'react';

import { useRouterRefresh } from '@/components/ui/refresh-button';
import { useBusyIds } from '@/hooks/use-busy-id';
import { describeFailure } from '@/lib/action-messages';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import type { HandoverFeedback, HandoverOperation } from './work-handover-feedback';
import { gateCount, OVERRIDEABLE_GATES, WARNING_GATES } from './work-handover-gates';

const ERROR_MESSAGES = {
  work_handover_not_authorized: 'Du bist für diese Übergabe nicht zuständig.',
  work_handover_target_not_found: 'Die Übergabe wurde nicht gefunden.',
  work_handover_target_load_failed: 'Auftrags- und Kundendaten konnten nicht geladen werden.',
  work_handover_sources_load_failed: 'Die auswählbaren Inhalte konnten nicht geladen werden.',
  work_handover_workspace_load_failed: 'Der Übergabestand konnte nicht geladen werden.',
  work_handover_summary_load_failed: 'Zeit- und Materialdaten konnten nicht geladen werden.',
  work_handover_stale_version: 'Die Übergabe wurde inzwischen geändert. Die Seite wird aktualisiert.',
  work_handover_execution_state_invalid: 'Die Ausführung muss zuerst abgeschlossen sein.',
  work_handover_source_stale:
    'Eine ausgewählte Quelle wurde inzwischen geändert. Bitte prüfe die Auswahl erneut.',
  work_handover_package_empty: 'Wähle mindestens einen freigegebenen Inhalt aus.',
  work_handover_gate_stale: 'Die Abschlussprüfung hat sich geändert. Bitte prüfe sie erneut.',
  work_handover_gate_snapshot_invalid: 'Die Abschlussprüfung ist unvollständig. Lade die Seite erneut.',
  work_handover_active_clock: 'Für diesen Auftrag läuft noch eine Zeiterfassung.',
  work_handover_review_blocked: 'Offene Prüfpunkte benötigen eine begründete Ausnahme.',
  work_handover_override_reason_required: 'Bitte begründe die Ausnahme nachvollziehbar.',
  work_handover_override_not_needed: 'Es gibt derzeit keinen Prüfschritt, der eine Ausnahme benötigt.',
  work_handover_release_state_invalid:
    'Der Übergabestand passt nicht zu dieser Aktion. Die Seite wird aktualisiert.',
  work_handover_preview_stale: 'Der Inhalt hat sich seit der Vorschau geändert. Erstelle eine neue Vorschau.',
  work_handover_sources_overflow:
    'Für diese Übergabe sind zu viele Quellen verknüpft. Bitte bereinige die Zuordnung.',
  work_handover_summary_overflow: 'Für diese Übergabe sind zu viele Zeit- oder Materialbuchungen verknüpft.',
  work_handover_action_failed: 'Die Übergabe konnte nicht gespeichert werden.',
} satisfies Record<string, string>;

/** The reviewer's selection, reasons, preview and per-operation feedback over the authoritative workspace props. */
export function useWorkHandoverReview(initialWorkspace: WorkHandoverWorkspace) {
  const { refresh: refreshRoute, isPending: isRefreshing } = useRouterRefresh();
  const [selectedKeys, setSelectedKeys] = useState(initialWorkspace.selectedSourceKeys);
  const [localPackageVersion, setLocalPackageVersion] = useState({
    base: initialWorkspace.packageVersion,
    value: initialWorkspace.packageVersion,
  });
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('Ausführung geprüft und vollständig an das Büro übergeben.');
  const [overrideReason, setOverrideReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  // The action whose click was refused for a missing reason; its fields show the error.
  const [attempted, setAttempted] = useState<'release' | 'withdraw' | 'correction' | null>(null);
  const [preview, setPreview] = useState<{
    releaseId: string;
    requestId: string;
    documentId: string;
    documentLinkId: string;
    contentHash: string;
    packageVersion: number;
  } | null>(null);
  const [feedback, setFeedback] = useState<HandoverFeedback | null>(null);
  const { run: runHandoverTask, isBusy, anyBusy } = useBusyIds<HandoverOperation>();
  // Server props are the authority. A release, a withdrawal or a changed
  // closing check in another session reloads them; the reset below keeps the
  // reviewer's selection unless the package itself changed.
  useRealtimeRouterRefresh({
    tables: [
      'work_handover_packages',
      'jobs',
      'projects',
      'work_blockers',
      'work_dependencies',
      'work_artifacts',
      'job_instruction_items',
      'job_instruction_item_evidence_fulfillments',
    ],
  });
  const workspaceAuthorityIdentity = JSON.stringify({
    targetId: initialWorkspace.targetId,
    executionVersion: initialWorkspace.executionVersion,
    packageState: initialWorkspace.packageState,
    packageVersion: initialWorkspace.packageVersion,
    selectedSourceKeys: initialWorkspace.selectedSourceKeys,
  });
  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedIdentity, setAdoptedIdentity] = useState(workspaceAuthorityIdentity);
  if (workspaceAuthorityIdentity !== adoptedIdentity) {
    setAdoptedIdentity(workspaceAuthorityIdentity);
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
      current && current.packageVersion === initialWorkspace.packageVersion ? current : null,
    );
    // This key represents every authoritative prop read above. Keeping typed
    // reasons outside the reset avoids losing reviewer input on refresh.
  }
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const overrideable = useMemo(
    () =>
      OVERRIDEABLE_GATES.flatMap(([key, label]) => {
        const count = gateCount(initialWorkspace.gateSnapshot, key);
        return count > 0 ? [{ key, label, count }] : [];
      }),
    [initialWorkspace.gateSnapshot],
  );
  const warnings = useMemo(
    () =>
      WARNING_GATES.flatMap(([key, label]) =>
        gateCount(initialWorkspace.gateSnapshot, key) > 0 ? [label] : [],
      ),
    [initialWorkspace.gateSnapshot],
  );
  const activeClocks = gateCount(initialWorkspace.gateSnapshot, 'activeJobClocks');
  const packageVersion =
    localPackageVersion.base === initialWorkspace.packageVersion
      ? localPackageVersion.value
      : initialWorkspace.packageVersion;
  const canEdit =
    initialWorkspace.executionState === 'execution_complete' && initialWorkspace.packageState !== 'released';
  const canPreview = canEdit && packageVersion > 0 && !dirty && selectedKeys.length > 0;

  const feedbackFor = (...operations: HandoverOperation[]): HandoverFeedback | null =>
    feedback && operations.includes(feedback.operation) ? feedback : null;
  const succeed = (operation: HandoverOperation, message: string): void =>
    setFeedback({ operation, tone: 'success', message });
  const fail = (operation: HandoverOperation, message: string): void =>
    setFeedback({ operation, tone: 'error', message });
  const failWithCode = (operation: HandoverOperation, code: string): void => {
    fail(operation, describeFailure(code, ERROR_MESSAGES, ERROR_MESSAGES.work_handover_action_failed));
    if (code.includes('stale')) refreshRoute();
  };

  return {
    refreshRoute,
    isRefreshing,
    selectedKeys,
    setSelectedKeys,
    setLocalPackageVersion,
    dirty,
    setDirty,
    reason,
    setReason,
    overrideReason,
    setOverrideReason,
    reopenReason,
    setReopenReason,
    attempted,
    setAttempted,
    preview,
    setPreview,
    setFeedback,
    runHandoverTask,
    isBusy,
    anyBusy,
    selectedKeySet,
    overrideable,
    warnings,
    activeClocks,
    packageVersion,
    canEdit,
    canPreview,
    feedbackFor,
    succeed,
    fail,
    failWithCode,
  };
}

export type WorkHandoverReview = ReturnType<typeof useWorkHandoverReview>;
