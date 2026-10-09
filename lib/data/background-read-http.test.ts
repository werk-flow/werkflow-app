import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('background read route preserves request authorization, the closed registry and independent transport', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/background-read-http.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});

// Decision D3 (pre-Wave-3 step 3): the readers a page runs in the background
// leave the browser's serialized Server Action queue. Each migrated surface
// reads through the client and must not import its former action module.
// Mutations on the same surfaces stay Server Actions, so the check is per
// reader name: none of these may be imported (and therefore queued) again.
const migratedReaders: Record<string, readonly string[]> = {
  'components/kalender/use-parking-data.ts': ['getParkedJobs', 'getJobParkingContexts'],
  'components/kalender/calendar-entry-dialog.tsx': ['getOrgMembersAction'],
  'hooks/use-planning-options.ts': ['getPlanningOptions'],
  'hooks/use-job-entity-options.ts': ['searchJobEntityOptions'],
  'hooks/use-weekly-time-data.ts': ['getTimeEntries', 'getWeeklyTargets'],
  'hooks/use-member-status.ts': ['getTimeEntries'],
  'components/zeiterfassung/vacation-section.tsx': ['getOwnVacationOverview'],
  'components/zeiterfassung/vacation-approvals.tsx': [
    'getPendingVacationRequestsForApprover',
    'getDecidableApprovedVacationRequests',
  ],
  'components/zeiterfassung/sickness-section.tsx': ['getOwnSicknessReports'],
  'components/zeiterfassung/provisional-time-summary.tsx': ['getProvisionalTimeSummary'],
  'components/zeiterfassung/time-correction-requests.tsx': ['getTimeCorrectionRequests'],
  'components/zeiterfassung/use-time-correction-dialog.ts': ['getTimeCorrectionFormOptions'],
  'components/zeiterfassung/entry-history.tsx': ['getTimeEntries', 'getProfilesByIds'],
  'components/zeiterfassung/pending-approvals.tsx': ['getPendingSessions', 'getPendingChangeRequests'],
  'components/auftraege/job-detail/job-detail-content.tsx': ['getTimeEntriesForJob'],
  'components/auftraege/job-detail/job-dispatch-section.tsx': ['getJobDispatchCards'],
  'components/auftraege/job-detail/job-qualification-section.tsx': ['getJobQualificationDetail'],
  'components/auftraege/artifacts/work-artifacts-section.tsx': ['getWorkArtifacts'],
  'components/auftraege/lifecycle/work-lifecycle-card.tsx': ['getWorkLifecycleSnapshot'],
  'components/inventar/job-materials-section.tsx': ['getJobMaterialLines'],
  'components/service/equipment-list-content.tsx': ['getInstalledEquipmentPage'],
  'components/service/service-case-list-content.tsx': ['getServiceCasePage'],
  'components/service/service-case-detail-content.tsx': ['getServiceCaseDetailByNumber'],
  'components/aufgaben/use-aufgaben-overview.ts': ['getAttentionOverview'],
  'components/mitarbeiter/personnel-own-actions-section.tsx': ['getOwnPersonnelActions'],
  'components/mitarbeiter/use-personnel-lifecycle-view.ts': ['getPersonnelLifecycle'],
  'components/mitarbeiter/sickness-reports-section.tsx': ['getSicknessReportsForRecord'],
  'components/arbeitsvorlagen/work-templates-content.tsx': ['getWorkTemplates', 'getWorkTemplate'],
  'components/service/maintenance-content.tsx': ['getMaintenanceWorkspace'],
  'components/job-picker-modal.tsx': ['getJobsForPicker'],
  'components/kalender/use-dispatch-panel-overview.ts': ['getDispatchOverview'],
  'components/auftraege/project-detail/use-project-detail-time.ts': ['getTimeEntriesForProjectJobs'],
  'components/service/use-equipment-detail-actions.ts': ['getInstalledEquipmentDetailByNumber'],
  'components/service/use-client-option.ts': ['getServiceClientOption'],
  'components/service/use-equipment-source-options.ts': ['getInstalledEquipmentSourceOptions'],
  'components/arbeitsvorlagen/use-apply-work-template.ts': [
    'getPublishedWorkTemplates',
    'getWorkTemplatePreview',
  ],
  'components/arbeitsvorlagen/work-template-picker.tsx': ['getPublishedWorkTemplates'],
  'components/auftraege/lifecycle/work-lifecycle-artifact-approval-dialog.tsx': [
    'getApprovedArtifactActionsForTarget',
  ],
  'components/auftraege/shared/employee-multi-select.tsx': ['getAssignmentTeamOptions'],
  'components/auftraege/shared/site-contact-fields.tsx': ['getClientRelations'],
  'components/dokumente/attach-document-dialog.tsx': ['getAttachableDocuments'],
  'components/inventar/use-job-material-dialog.ts': [
    'getInventoryPickerPage',
    'getInventoryPickerOptionsForJob',
  ],
  'components/kalender/dispatch-issue-dialog.tsx': ['previewDispatchReadiness'],
  'components/kalender/parking-context-dialog.tsx': ['getParkingResponsibleOptions'],
  'components/service/maintenance-coverage-documents-dialog.tsx': ['getMaintenanceCoverageDocuments'],
  'components/service/use-maintenance-due-action.ts': ['getMaintenanceEvidenceOptions'],
  'components/use-manual-entry-form-members.ts': ['getOrgMembersAction'],
};

test('migrated background readers use the GET client and no longer queue as Server Actions', () => {
  for (const [file, readers] of Object.entries(migratedReaders)) {
    const source = readFileSync(resolve(import.meta.dir, '../..', file), 'utf8');
    expect(source, `${file} must read through the background client`).toMatch(
      /from ['"]@\/lib\/data\/background-read-client['"]/,
    );
    const importedNames = [
      ...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/[^'"]*actions['"]/g),
    ].flatMap((match) => (match[1] ?? '').split(',').map((name) => name.trim().replace(/^type\s+/, '')));
    for (const reader of readers) {
      expect(importedNames, `${file} still imports the Server Action reader ${reader}`).not.toContain(reader);
    }
  }
});
