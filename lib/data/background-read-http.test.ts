import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('background read route preserves request authorization, the closed registry and independent transport', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/background-read-http.ts')], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});

// Decision D3 (pre-Wave-3 step 3): the readers a page runs in the background
// leave the browser's serialized Server Action queue. Each migrated surface
// reads through the client and must not import its former action module.
// Mutations on the same surfaces stay Server Actions, so the check is per
// reader name: none of these may be imported (and therefore queued) again.
const migratedReaders: Record<string, readonly string[]> = {
  'hooks/use-weekly-time-data.ts': ['getTimeEntries', 'getWeeklyTargets'],
  'hooks/use-member-status.ts': ['getTimeEntries'],
  'components/zeiterfassung/vacation-section.tsx': ['getOwnVacationOverview'],
  'components/zeiterfassung/vacation-approvals.tsx': ['getPendingVacationRequestsForApprover', 'getDecidableApprovedVacationRequests'],
  'components/zeiterfassung/sickness-section.tsx': ['getOwnSicknessReports'],
  'components/zeiterfassung/provisional-time-summary.tsx': ['getProvisionalTimeSummary'],
  'components/zeiterfassung/time-correction-requests.tsx': ['getTimeCorrectionRequests'],
  'components/zeiterfassung/entry-history.tsx': ['getTimeEntries', 'getProfilesByIds'],
  'components/zeiterfassung/pending-approvals.tsx': ['getPendingSessions', 'getPendingChangeRequests'],
  'components/auftraege/job-detail-content.tsx': ['getTimeEntriesForJob'],
  'components/auftraege/job-dispatch-section.tsx': ['getJobDispatchCards'],
  'components/auftraege/job-qualification-section.tsx': ['getJobQualificationDetail'],
  'components/auftraege/work-artifacts-section.tsx': ['getWorkArtifacts'],
  'components/auftraege/work-lifecycle-card.tsx': ['getWorkLifecycleSnapshot'],
  'components/inventar/job-materials-section.tsx': ['getJobMaterialLines'],
};

test('migrated background readers use the GET client and no longer queue as Server Actions', () => {
  for (const [file, readers] of Object.entries(migratedReaders)) {
    const source = readFileSync(resolve(import.meta.dir, '../..', file), 'utf8');
    expect(source, `${file} must read through the background client`).toMatch(/from ['"]@\/lib\/data\/background-read-client['"]/);
    const importedNames = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/[^'"]*actions['"]/g)]
      .flatMap((match) => (match[1] ?? '').split(',').map((name) => name.trim().replace(/^type\s+/, '')));
    for (const reader of readers) {
      expect(importedNames, `${file} still imports the Server Action reader ${reader}`).not.toContain(reader);
    }
  }
});
