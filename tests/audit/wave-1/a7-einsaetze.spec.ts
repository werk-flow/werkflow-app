import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../golden/support/fixtures';
import { requireEnv } from '../../golden/support/env';
import {
  getCommitmentState,
  getDispatchState,
  getOrganizationTimeEntryCount,
  getParkingState,
} from '../../golden/support/db';
import {
  acknowledgeDispatchOnJobPage,
  addSiteOnCustomerDetail,
  createCustomer,
  createJob,
  createPersonnelRecordViaDialog,
  createPlannedCalendarEntry,
  dispatchOccurrenceRow,
  editPlannedCalendarOccurrence,
  issueDispatchForOccurrence,
  openAufgaben,
  openCustomerDetail,
  openDispatchPanel,
  openParkplatzPanel,
  parkplatzCard,
  selectFromSearchable,
  showPlanningMonth,
  typeIntoDatePicker,
  typeIntoTimeInput,
  visibleText,
} from '../../golden/support/steps';
import { requireChainedValue, requireSerialPrecondition } from '../../golden/support/preconditions';
import { berlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  dispatchPanel,
  draggablePlanningBlock,
  firstDispatchPanelText,
  planningOccurrenceInDateCell,
  unscheduledDispatchRow,
} from '../support/a7-steps';
import { formatBerlinLocalDateTime } from '../../../lib/planning/date-time';

// A7 — Einsätze (P1-12). Serial journeys over the shared audit world; every
// business mutation runs through the real UI and the database access below is
// read-only assertion state. A7 creates NO uniqueness-constrained rows
// (conditions, absences, closure days); its planning fixtures use run-scoped
// titles on near dates because the dispatch panel's overview window covers
// only the next 14 days. The owned +55…+64 reserve therefore stays unused.

test.describe.configure({ mode: 'serial' });

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

// The panel's schedule formatter renders "Mo., 24.08., 06:00 Uhr" — the
// day-month fragment is the stable per-row identity for preview assertions.
function shortGermanDayMonth(dateIso: string): string {
  const [, month, day] = dateIso.split('-');
  return `${day}.${month}.`;
}

// The Berlin base date is frozen at module load so every serial test shares
// identical dates even when a battery run crosses midnight (A6 lesson).
const A7_TODAY_ISO = berlinDateAtOffset(0);
const MAIN_DATE = berlinDateAtOffset(5);
const MAIN_MOVED_DATE = berlinDateAtOffset(6);
const COMMIT_DATE = berlinDateAtOffset(8);
const COMMIT_MOVED_DATE = berlinDateAtOffset(9);
const SERIES_DATE = berlinDateAtOffset(10);
const SERIES_SECOND_SOURCE_DATE = berlinDateAtOffset(11);
const SERIES_SHIFTED_FIRST = berlinDateAtOffset(11);
const SERIES_SHIFTED_SECOND = berlinDateAtOffset(12);
const ALLDAY_DATE = berlinDateAtOffset(13);

const OVERRIDE_REASON = 'Betrieblich abgestimmter A7 Einsatz.';
const MAIN_NOTE = 'Schlüssel beim Hausmeister abholen, Code 4711.';
const RESEND_NOTE = 'Neuer Hinweis: Ersatzteil liegt im Fahrzeug bereit.';

const READINESS_LABELS: Record<string, string> = {
  capacity: 'Kapazität & Verfügbarkeit',
  qualification: 'Qualifikationen',
  site: 'Einsatzort',
  travel: 'Fahrzeit',
  tools: 'Werkzeuge',
};

// ---------------------------------------------------------------------------
// Audit-local read-only database observers (A7 only — deliberately NOT part of
// the golden harness). Service-role SELECTs used exclusively for assertions.
// ---------------------------------------------------------------------------

let readOnlyAdminClient: SupabaseClient | null = null;

function createReadOnlyAdminClient(): SupabaseClient {
  readOnlyAdminClient ??= createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SECRET_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return readOnlyAdminClient;
}

async function getJobIdByNumber(orgId: string, jobNumber: string): Promise<string> {
  const admin = createReadOnlyAdminClient();
  const { data, error } = await admin
    .from('jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber)
    .single();
  if (error || !data) {
    throw new Error(`A7 job lookup failed for ${jobNumber}: ${error?.message}`);
  }
  return data.id as string;
}

async function getJobOccurrences(
  orgId: string,
  jobNumber: string
): Promise<
  Array<{
    id: string;
    seriesId: string | null;
    isException: boolean;
    status: string;
    startAt: string | null;
    startDate: string | null;
  }>
> {
  const admin = createReadOnlyAdminClient();
  const jobId = await getJobIdByNumber(orgId, jobNumber);
  const { data, error } = await admin
    .from('planning_occurrences')
    .select('id, series_id, is_exception, status, start_at, start_date')
    .eq('organization_id', orgId)
    .eq('job_id', jobId)
    .order('start_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`A7 occurrence lookup failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    seriesId: row.series_id as string | null,
    isException: Boolean(row.is_exception),
    status: row.status as string,
    startAt: row.start_at as string | null,
    startDate: row.start_date as string | null,
  }));
}

// Shared lookup: every dispatch belonging to a job, whether it targets the
// job directly or one of the job's occurrences.
async function getDispatchIdsForJob(orgId: string, jobNumber: string): Promise<string[]> {
  const admin = createReadOnlyAdminClient();
  const jobId = await getJobIdByNumber(orgId, jobNumber);
  const occurrences = await getJobOccurrences(orgId, jobNumber);
  let dispatchQuery = admin.from('planning_dispatches').select('id').eq('organization_id', orgId);
  dispatchQuery = occurrences.length
    ? dispatchQuery.or(
        `job_id.eq.${jobId},occurrence_id.in.(${occurrences
          .map((occurrence) => occurrence.id)
          .join(',')})`
      )
    : dispatchQuery.eq('job_id', jobId);
  const { data: dispatches, error } = await dispatchQuery;
  if (error) throw new Error(`A7 dispatch lookup failed: ${error.message}`);
  return (dispatches ?? []).map((row) => row.id as string);
}

async function getDispatchRevisionNotes(
  orgId: string,
  jobNumber: string
): Promise<Array<{ dispatchId: string; revisionNumber: number; note: string | null }>> {
  const admin = createReadOnlyAdminClient();
  const dispatchIds = await getDispatchIdsForJob(orgId, jobNumber);
  if (!dispatchIds.length) return [];
  const { data: revisions, error } = await admin
    .from('planning_dispatch_revisions')
    .select('dispatch_id, revision_number, dispatch_note')
    .eq('organization_id', orgId)
    .in('dispatch_id', dispatchIds)
    .order('revision_number', { ascending: true });
  if (error) throw new Error(`A7 revision lookup failed: ${error.message}`);
  return (revisions ?? []).map((row) => ({
    dispatchId: row.dispatch_id as string,
    revisionNumber: row.revision_number as number,
    note: row.dispatch_note as string | null,
  }));
}

async function getDispatchCancellationCauses(orgId: string, jobNumber: string): Promise<string[]> {
  const admin = createReadOnlyAdminClient();
  const dispatchIds = await getDispatchIdsForJob(orgId, jobNumber);
  if (!dispatchIds.length) return [];
  const { data: events, error } = await admin
    .from('planning_dispatch_events')
    .select('event_type, payload')
    .eq('organization_id', orgId)
    .in('dispatch_id', dispatchIds)
    .eq('event_type', 'cancelled');
  if (error) throw new Error(`A7 dispatch event lookup failed: ${error.message}`);
  return (events ?? []).map((row) => {
    const payload = row.payload as { cause?: string } | null;
    return payload?.cause ?? '';
  });
}

async function getCommitmentFacts(
  orgId: string,
  jobNumber: string
): Promise<
  Array<{
    status: string;
    source: string;
    committedDate: string;
    windowStartTime: string | null;
    windowEndTime: string | null;
    withdrawalReason: string | null;
  }>
> {
  const admin = createReadOnlyAdminClient();
  const occurrences = await getJobOccurrences(orgId, jobNumber);
  if (!occurrences.length) return [];
  const { data, error } = await admin
    .from('planning_customer_commitments')
    .select(
      'status, source, committed_date, window_start_time, window_end_time, withdrawal_reason, recorded_at'
    )
    .eq('organization_id', orgId)
    .in(
      'occurrence_id',
      occurrences.map((o) => o.id)
    )
    .order('recorded_at', { ascending: true });
  if (error) throw new Error(`A7 commitment lookup failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    status: row.status as string,
    source: row.source as string,
    committedDate: row.committed_date as string,
    windowStartTime: row.window_start_time as string | null,
    windowEndTime: row.window_end_time as string | null,
    withdrawalReason: row.withdrawal_reason as string | null,
  }));
}

async function getEmployeeRecordIdByLastName(orgId: string, lastName: string): Promise<string> {
  const admin = createReadOnlyAdminClient();
  const { data, error } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', orgId)
    .eq('last_name', lastName);
  if (error || (data?.length ?? 0) !== 1) {
    throw new Error(
      `A7 employee record lookup for "${lastName}" failed: ${error?.message ?? `${data?.length ?? 0} rows`}`
    );
  }
  return data![0].id as string;
}

// The batch RPC preserves each occurrence's history as a per-occurrence
// 'edited' event carrying the batchRequestId, plus ONE 'batch_rescheduled'
// marker event whose after_state lists every moved occurrence id.
async function getBatchPlanningHistory(
  orgId: string,
  occurrenceIds: string[]
): Promise<{
  editedWithBatchRequest: string[];
  batchEventOccurrenceIdSets: string[][];
}> {
  const admin = createReadOnlyAdminClient();
  const { data, error } = await admin
    .from('planning_events')
    .select('occurrence_id, event_type, after_state')
    .eq('organization_id', orgId)
    .in('occurrence_id', occurrenceIds);
  if (error) throw new Error(`A7 planning event lookup failed: ${error.message}`);
  const editedWithBatchRequest = [
    ...new Set(
      (data ?? [])
        .filter((row) => {
          const after = row.after_state as { batchRequestId?: string } | null;
          return row.event_type === 'edited' && Boolean(after?.batchRequestId);
        })
        .map((row) => row.occurrence_id as string)
    ),
  ];
  const batchEventOccurrenceIdSets = (data ?? [])
    .filter((row) => row.event_type === 'batch_rescheduled')
    .map((row) => {
      const after = row.after_state as { occurrenceIds?: string[] } | null;
      return [...(after?.occurrenceIds ?? [])].sort();
    });
  return { editedWithBatchRequest, batchEventOccurrenceIdSets };
}

// ---------------------------------------------------------------------------
// Audit-local UI helpers.
// ---------------------------------------------------------------------------

function issueDialog(page: Page): Locator {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Einsatz senden' }) });
}

async function openIssueDialogForPanelRow(page: Page, title: string): Promise<Locator> {
  const row = dispatchOccurrenceRow(page, title);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Einsatz senden' }).click();
  const dialog = issueDialog(page);
  await expect(
    dialog.locator('[data-readiness-key="tools"][data-readiness-state="unknown"]')
  ).toBeVisible({ timeout: 20_000 });
  return dialog;
}

function readinessDimension(dialog: Locator, key: string): Locator {
  return dialog.locator(`[data-readiness-key="${key}"]`);
}

function occurrenceEventInCell(page: Page, dateIso: string, title: string): Locator {
  return planningOccurrenceInDateCell(page, dateIso, title);
}

async function openOccurrenceEditDialogByDate(
  page: Page,
  title: string,
  dateIso: string
): Promise<Locator> {
  await showPlanningMonth(page, dateIso);
  const event = occurrenceEventInCell(page, dateIso, title);
  await expect(event).toBeVisible({ timeout: 20_000 });
  await event.click();
  await page.getByRole('button', { name: 'Termin bearbeiten' }).click();
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Geplanten Termin bearbeiten' }),
  });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function addAssigneeInEditDialog(
  page: Page,
  dialog: Locator,
  searchText: string
): Promise<void> {
  await dialog
    .getByRole('combobox')
    .filter({ hasText: /Mitarbeiter/ })
    .click();
  await page.getByPlaceholder(/Mitarbeiter suchen/).fill(searchText);
  await page.getByRole('listbox').getByRole('button').filter({ hasText: searchText }).click();
  await dialog.getByRole('heading', { name: 'Geplanten Termin bearbeiten' }).click();
}

// Mirrors the shared planning-save contract for the occurrence edit dialog:
// the capacity warning renders inline with `#planning-edit-reason`.
async function saveOccurrenceEditWithOverride(
  dialog: Locator,
  overrideReason: string
): Promise<void> {
  await dialog.getByRole('button', { name: /Änderung speichern/ }).click();
  await expect
    .poll(
      async () => {
        if (!(await dialog.isVisible().catch(() => false))) return 'closed';
        if (
          await dialog
            .locator('[data-planning-warning]')
            .isVisible()
            .catch(() => false)
        ) {
          return 'warning';
        }
        return 'pending';
      },
      { timeout: 30_000 }
    )
    .not.toBe('pending');
  if (!(await dialog.isVisible().catch(() => false))) return;
  await dialog.locator('#planning-edit-reason').fill(overrideReason);
  await dialog.getByRole('button', { name: /Mit Begründung planen|Änderung speichern/ }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

function jobDispatchSection(page: Page): Locator {
  return page.getByTestId('job-dispatch-section');
}

// The /aufgaben deep link is the catalog's second confirmation path — no
// direct goto to the job page here, the task link IS the navigation.
async function openJobViaDispatchTask(page: Page, title: string): Promise<void> {
  await openAufgaben(page);
  const taskGroup = page.getByTestId('attention-dispatch-tasks');
  await expect(taskGroup).toBeVisible({ timeout: 20_000 });
  await taskGroup
    .getByRole('link', { name: `Einsatz für ${title} bestätigen`, exact: true })
    .click();
  await page.waitForURL(/\/auftraege\//, { timeout: 20_000 });
  await expect(jobDispatchSection(page)).toBeVisible({ timeout: 20_000 });
}

function reasonDialog(page: Page, heading: string): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: heading }) });
}

async function inheritedDispatchState(
  orgId: string,
  jobNumber: string
): Promise<Awaited<ReturnType<typeof getDispatchState>> | null> {
  const admin = createReadOnlyAdminClient();
  const { data, error } = await admin
    .from('jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber)
    .maybeSingle();
  if (error) {
    throw new Error(`A7 inherited job lookup failed: ${error.message}`);
  }
  return data ? getDispatchState(orgId, jobNumber) : null;
}

// Shared across the serial A7 tests: the organization-wide actual-time count
// captured before any A7 dispatch exists (acknowledging must never create
// time).
let organizationTimeBaseline: number | null = null;

test.describe('A7 Einsätze @AUDIT-W1-A7', () => {
  test('A7-T1: Das Bereitschaftsbild ist ehrlich — sechs Dimensionen, Material nie reserviert, Unbekanntes nie grün [P1-12-F02]', async ({
    adminPage,
    world,
  }) => {
    organizationTimeBaseline = await getOrganizationTimeEntryCount(world.orgId);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const customerName = `A7 Kundin ${world.runId}`;
    const mainTitle = `A7 Einsatzbesuch ${world.runId}`;

    await createCustomer(adminPage, customerName, {
      type: 'Gewerblich',
      address: 'A7 Nordstraße 7, 10115 Berlin',
    });
    await openCustomerDetail(adminPage, customerName);
    await addSiteOnCustomerDetail(adminPage, {
      name: `A7 Werk Nord ${world.runId}`,
      street: 'Nordstraße 7',
      postalCode: '10115',
      city: 'Berlin',
      accessNotes: 'Zugang über Tor 2, Code 4711',
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: `A7 Werk Süd ${world.runId}`,
      street: 'Südstraße 9',
      postalCode: '12099',
      city: 'Berlin',
    });

    await createJob(adminPage, {
      jobNumber: `A7-MAIN-${world.runId}`,
      title: mainTitle,
      clientName: customerName,
      siteName: `A7 Werk Nord ${world.runId}`,
    });

    // Planned material demand against the seeded stock: the readiness picture
    // must label it "nicht reserviert" no matter how much stock exists.
    await adminPage.goto(`/auftraege/A7-MAIN-${world.runId}`);
    await adminPage.getByRole('button', { name: 'Material planen' }).click();
    const materialDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Material planen' }),
    });
    await materialDialog.getByLabel('Artikel suchen').fill(world.inventory.itemName);
    await materialDialog.getByRole('button').filter({ hasText: world.inventory.itemName }).click();
    await materialDialog.locator('input[id$="-quantity"]').fill('2');
    await selectFromSearchable(
      adminPage,
      materialDialog.locator('button[id$="-location"]'),
      world.inventory.locationName
    );
    await materialDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(materialDialog).toHaveCount(0, { timeout: 20_000 });

    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: `A7-MAIN-${world.runId}`,
      date: MAIN_DATE,
      time: '06:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    await openDispatchPanel(adminPage);
    const dialog = await openIssueDialogForPanelRow(adminPage, mainTitle);

    // All six dimensions render as labeled content.
    for (const [key, label] of Object.entries(READINESS_LABELS)) {
      await expect(readinessDimension(dialog, key)).toBeVisible();
      await expect(readinessDimension(dialog, key)).toContainText(label);
    }
    // Capacity comes from the planning assessment: the audit world has no
    // work schedules, so the schedule-fallback warning is deterministic.
    await expect(
      dialog.locator('[data-readiness-key="capacity"][data-readiness-state="warning"]')
    ).toBeVisible();
    // Site/access facts are visible.
    await expect(readinessDimension(dialog, 'site')).toContainText(`A7 Werk Nord ${world.runId}`);
    await expect(readinessDimension(dialog, 'site')).toContainText('Zugang über Tor 2, Code 4711');
    // Travel has no provable fact yet — honestly "nicht bewertet".
    await expect(
      dialog.locator('[data-readiness-key="travel"][data-readiness-state="unknown"]')
    ).toBeVisible();
    await expect(readinessDimension(dialog, 'travel')).toContainText('Fahrzeit nicht bewertet.');
    // Material demand is ALWAYS labeled unreserved, per line and per label.
    await expect(readinessDimension(dialog, 'material')).toContainText(
      'Material (nicht reserviert)'
    );
    await expect(readinessDimension(dialog, 'material')).toContainText(
      `${world.inventory.itemName}`
    );
    await expect(readinessDimension(dialog, 'material')).toContainText('– nicht reserviert.');
    // Tools are never assessed in this slice.
    await expect(readinessDimension(dialog, 'tools')).toContainText('(nicht bewertet)');
    await expect(readinessDimension(dialog, 'tools')).toContainText(
      'Werkzeugverfügbarkeit nicht bewertet.'
    );
    // The negative: no unknown dimension may borrow the success icon.
    const unknownDimensions = dialog.locator('[data-readiness-state="unknown"]');
    const renderedUnknownDimensions = await unknownDimensions.all();
    expect(renderedUnknownDimensions.length).toBeGreaterThan(0);
    for (const unknownDimension of renderedUnknownDimensions) {
      await expect(unknownDimension.locator('[data-readiness-icon="unknown"]')).toBeVisible();
      await expect(unknownDimension.locator('[data-readiness-icon="ok"]')).toHaveCount(0);
    }

    // The optional Hinweistext travels with the dispatch.
    await dialog.locator('#dispatch-note').fill(MAIN_NOTE);
    await dialog.getByRole('button', { name: 'Einsatz senden' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const state = await getDispatchState(world.orgId, `A7-MAIN-${world.runId}`);
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0].status).toBe('active');
    const notes = await getDispatchRevisionNotes(world.orgId, `A7-MAIN-${world.runId}`);
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe(MAIN_NOTE);
  });

  test('A7-T2: Belegbare Fahrzeit warnt; die Mein-Einsatz-Karte trägt Termin, Ort und Hinweis; Bestätigen läuft über /aufgaben [P1-12-F02/P1-12-F03/P1-12-F07]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const organizationTimeStart = requireChainedValue(organizationTimeBaseline, {
      test: 'A7-T2',
      needs: 'the organization time-entry baseline captured before A7 dispatches',
      grep: 'A7-T1|A7-T2',
      suite: 'audit',
    });
    const inheritedMainDispatch = await inheritedDispatchState(
      world.orgId,
      `A7-MAIN-${world.runId}`
    );
    requireSerialPrecondition(inheritedMainDispatch?.dispatches.length === 1, {
      test: 'A7-T2',
      needs: 'the main dispatch issued by A7-T1',
      grep: 'A7-T1|A7-T2',
      suite: 'audit',
    });
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const customerName = `A7 Kundin ${world.runId}`;
    const mainTitle = `A7 Einsatzbesuch ${world.runId}`;
    const travelTitle = `A7 Anschlussbesuch ${world.runId}`;

    // A provable travel fact: the same person leaves the Nord site at 07:00
    // and starts at the Süd site at 07:00 — zero gap between different sites.
    await createJob(adminPage, {
      jobNumber: `A7-TRAVEL-${world.runId}`,
      title: travelTitle,
      clientName: customerName,
      siteName: `A7 Werk Süd ${world.runId}`,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: `A7-TRAVEL-${world.runId}`,
      date: MAIN_DATE,
      time: '07:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    await openDispatchPanel(adminPage);
    const travelDialog = await openIssueDialogForPanelRow(adminPage, travelTitle);
    await expect(
      travelDialog.locator('[data-readiness-key="travel"][data-readiness-state="warning"]')
    ).toBeVisible();
    await expect(readinessDimension(travelDialog, 'travel')).toContainText('keine Zeit zwischen');
    await travelDialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(travelDialog).toHaveCount(0, { timeout: 15_000 });
    // The panel surfaces the same provable fact as a Fahrzeit-Hinweis.
    await expect(firstDispatchPanelText(adminPage, /keine Zeit zwischen/)).toBeVisible({
      timeout: 20_000,
    });

    // The worker's card: Termin, Ort, Hinweis — then confirmation VIA the
    // /aufgaben task (deep link, not a direct navigation).
    await openJobViaDispatchTask(employeePage, mainTitle);
    const card = jobDispatchSection(employeePage).locator('[data-dispatch-state="ausstehend"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(`${formatGermanDate(MAIN_DATE)}, 06:00`);
    await expect(card).toContainText('Nordstraße 7');
    await expect(card).toContainText(`Hinweis: ${MAIN_NOTE}`);
    await jobDispatchSection(employeePage)
      .getByRole('button', { name: 'Einsatz bestätigen' })
      .click();
    await expect(
      jobDispatchSection(employeePage).locator('[data-dispatch-state="bestaetigt"]')
    ).toBeVisible({ timeout: 20_000 });

    const state = await getDispatchState(world.orgId, `A7-MAIN-${world.runId}`);
    expect(
      state.dispatches[0].acknowledgements.filter(
        (ack) => ack.revisionNumber === 1 && ack.state === 'acknowledged'
      )
    ).toHaveLength(1);
    // A confirmation is only "seen and accepted": no time, no commitment.
    expect(await getOrganizationTimeEntryCount(world.orgId)).toBe(organizationTimeStart);
    expect(await getCommitmentState(world.orgId, `A7-MAIN-${world.runId}`)).toHaveLength(0);
  });

  test('A7-T3: Empfängerstände — Übernommen bei reiner Empfängeränderung, „nicht möglich" ohne Login, nie automatisch bestätigt [P1-12-F01/P1-12-F04]', async ({
    adminPage,
    world,
  }) => {
    const inheritedMainDispatch = await inheritedDispatchState(
      world.orgId,
      `A7-MAIN-${world.runId}`
    );
    requireSerialPrecondition(
      inheritedMainDispatch?.dispatches[0]?.acknowledgements.some(
        (acknowledgement) => acknowledgement.state === 'acknowledged'
      ) === true,
      {
        test: 'A7-T3',
        needs: 'the main dispatch acknowledged in A7-T2',
        grep: 'A7-T1|A7-T2|A7-T3',
        suite: 'audit',
      }
    );
    const mainTitle = `A7 Einsatzbesuch ${world.runId}`;
    const emilName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const brunoFirstName = world.users.buero.firstName;
    const noLoginLastName = `Nurpapier-${world.runId}`;

    await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Nils',
      lastName: noLoginLastName,
    });
    const noLoginRecordId = await getEmployeeRecordIdByLastName(world.orgId, noLoginLastName);

    // A PURE recipient-set change: the visit itself stays untouched.
    const editDialog = await openOccurrenceEditDialogByDate(adminPage, mainTitle, MAIN_DATE);
    await addAssigneeInEditDialog(adminPage, editDialog, brunoFirstName);
    await addAssigneeInEditDialog(adminPage, editDialog, `Nils ${noLoginLastName}`);
    await saveOccurrenceEditWithOverride(editDialog, OVERRIDE_REASON);

    const state = await getDispatchState(world.orgId, `A7-MAIN-${world.runId}`);
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0].revisionChangeKinds).toEqual(['issued', 'reassigned']);
    expect(state.dispatches[0].currentRevisionNumber).toBe(2);
    expect(state.dispatches[0].currentRecipientRecordIds).toHaveLength(3);
    // The unchanged recipient's confirmation lives on traceably.
    const revisionTwoAcks = state.dispatches[0].acknowledgements.filter(
      (ack) => ack.revisionNumber === 2
    );
    expect(revisionTwoAcks).toHaveLength(1);
    expect(revisionTwoAcks[0].state).toBe('carried_forward');
    // A record without login is NEVER auto-confirmed — zero acknowledgement
    // rows exist for it on any revision.
    expect(
      state.dispatches[0].acknowledgements.filter((ack) => ack.employeeRecordId === noLoginRecordId)
    ).toHaveLength(0);

    // The panel shows the full visible state vocabulary.
    await openDispatchPanel(adminPage);
    const row = dispatchOccurrenceRow(adminPage, mainTitle);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('[data-recipient-state="uebernommen"]')).toContainText(
      `${emilName} · Übernommen`
    );
    await expect(row.locator('[data-recipient-state="ausstehend"]')).toContainText(
      'Bestätigung ausstehend'
    );
    await expect(row.locator('[data-recipient-state="nicht_moeglich"]')).toContainText(
      `Nils ${noLoginLastName} · Ohne Zugang – Bestätigung nicht möglich`
    );
  });

  test('A7-T4: Rückfrage über /aufgaben wird Manager-Aufgabe; die Plananpassung erzeugt automatisch den neuen Stand; ein geänderter Ort macht Bestätigungen ungültig [P1-12-F03/P1-12-F04/P1-12-F05]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const inheritedMainDispatch = await inheritedDispatchState(
      world.orgId,
      `A7-MAIN-${world.runId}`
    );
    requireSerialPrecondition(inheritedMainDispatch?.dispatches[0]?.currentRevisionNumber === 2, {
      test: 'A7-T4',
      needs: 'the reassigned main dispatch produced by A7-T3',
      grep: 'A7-T1|A7-T2|A7-T3|A7-T4',
      suite: 'audit',
    });
    const mainTitle = `A7 Einsatzbesuch ${world.runId}`;
    const brunoName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const challengeReason = 'A7 Terminüberschneidung mit anderem Einsatz.';
    const newLocation = `A7 Ausweichlager Ost ${world.runId}`;

    // The recipient challenges VIA the /aufgaben task's deep link.
    await openJobViaDispatchTask(bueroPage, mainTitle);
    await bueroPage.getByRole('button', { name: 'Rückfrage stellen' }).click();
    const challengeDialog = reasonDialog(bueroPage, 'Rückfrage zum Einsatz');
    await challengeDialog.locator('#dispatch-challenge-reason').fill(challengeReason);
    await challengeDialog.getByRole('button', { name: 'Rückfrage senden' }).click();
    await expect(challengeDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(
      jobDispatchSection(bueroPage).locator('[data-dispatch-state="rueckfrage"]')
    ).toBeVisible({ timeout: 20_000 });

    // The open challenge is a manager task AND visible in the panel.
    await openAufgaben(adminPage);
    const challengeGroup = adminPage.getByTestId('attention-dispatch-challenge-tasks');
    await expect(challengeGroup).toBeVisible({ timeout: 20_000 });
    const challengeTask = challengeGroup.getByRole('link', {
      name: `Rückfrage von ${brunoName} zu ${mainTitle} öffnen`,
      exact: true,
    });
    await expect(challengeTask).toBeVisible();
    await expect(challengeGroup.getByText(challengeReason)).toBeVisible();
    await openDispatchPanel(adminPage);
    await expect(firstDispatchPanelText(adminPage, challengeReason)).toBeVisible({
      timeout: 20_000,
    });

    // Resolution by ADAPTING the plan: moving the visit supersedes the
    // revision, closes the challenge, and the recipient sees the new state.
    await editPlannedCalendarOccurrence(adminPage, {
      title: mainTitle,
      calendarDate: MAIN_DATE,
      scope: 'one',
      date: MAIN_MOVED_DATE,
      overrideReason: OVERRIDE_REASON,
    });

    let state = await getDispatchState(world.orgId, `A7-MAIN-${world.runId}`);
    expect(state.dispatches[0].revisionChangeKinds).toEqual([
      'issued',
      'reassigned',
      'schedule_changed',
    ]);
    const resolvedChallenge = state.dispatches[0].acknowledgements.find(
      (ack) => ack.revisionNumber === 2 && ack.state === 'challenged'
    );
    expect(resolvedChallenge?.challengeResolution).toBe('superseded');
    await openAufgaben(adminPage);
    await expect(
      adminPage.getByRole('link', {
        name: `Rückfrage von ${brunoName} zu ${mainTitle} öffnen`,
        exact: true,
      })
    ).toHaveCount(0);

    // The recipient sees "ausstehend" WITH the new state (the moved date).
    await bueroPage.goto(`/auftraege/A7-MAIN-${world.runId}`);
    const pendingCard = jobDispatchSection(bueroPage).locator('[data-dispatch-state="ausstehend"]');
    await expect(pendingCard).toBeVisible({ timeout: 20_000 });
    await expect(pendingCard).toContainText(formatGermanDate(MAIN_MOVED_DATE));

    // A changed Ort is a material instruction change: the confirmed dispatch
    // is superseded again and the card shows the new location.
    await jobDispatchSection(bueroPage).getByRole('button', { name: 'Einsatz bestätigen' }).click();
    await expect(
      jobDispatchSection(bueroPage).locator('[data-dispatch-state="bestaetigt"]')
    ).toBeVisible({ timeout: 20_000 });

    await adminPage.goto(`/auftraege/A7-MAIN-${world.runId}`);
    await adminPage.getByRole('button', { name: 'Aktionen öffnen' }).click();
    await adminPage.getByRole('menuitem', { name: /Bearbeiten/ }).click();
    const editJobDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Auftrag bearbeiten' }),
    });
    await expect(editJobDialog).toBeVisible({ timeout: 15_000 });
    await editJobDialog.locator('#edit-job-location').fill(newLocation);
    await editJobDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(editJobDialog).toHaveCount(0, { timeout: 20_000 });

    await expect
      .poll(
        async () => {
          state = await getDispatchState(world.orgId, `A7-MAIN-${world.runId}`);
          return state.dispatches[0].revisionChangeKinds;
        },
        { timeout: 20_000 }
      )
      .toEqual(['issued', 'reassigned', 'schedule_changed', 'instruction_changed']);
    expect(
      state.dispatches[0].acknowledgements.filter((ack) => ack.revisionNumber === 4)
    ).toHaveLength(0);
    const invalidatedCard = jobDispatchSection(bueroPage).locator(
      '[data-dispatch-state="ausstehend"]'
    );
    await expect(invalidatedCard).toBeVisible({ timeout: 20_000 });
    await expect(invalidatedCard).toContainText(newLocation);
  });

  test('A7-T5: Parkplatz — bewusster Kontext, Einsatz an die Zugewiesenen, manueller Storno und Neusenden mit geändertem Hinweis [P1-12-F04/P1-12-F06/P1-12-F12/P1-14-F21]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const parkTitle = `A7 Rückstau ${world.runId}`;
    const emilName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    await createJob(adminPage, {
      jobNumber: `A7-PARK-${world.runId}`,
      title: parkTitle,
      assignEmployeeName: world.users.employee.firstName,
    });
    await adminPage.goto(`/auftraege/A7-PARK-${world.runId}`);
    const lifecycle = adminPage.getByTestId('work-lifecycle-card');
    await lifecycle.getByRole('button', { name: 'Parken', exact: true }).click();
    const parkingDialog = adminPage.getByRole('dialog');
    await selectFromSearchable(adminPage, parkingDialog.locator('#work-blocker-reason'), 'Kapazität');
    await parkingDialog
      .locator('#work-blocker-details')
      .fill('Einsatz wird aus dem Parkplatz heraus abgestimmt.');
    await selectFromSearchable(
      adminPage,
      parkingDialog.locator('#work-blocker-owner'),
      world.users.admin.firstName
    );
    await typeIntoDatePicker(
      parkingDialog,
      'Wiedervorlage',
      toDatePickerDigits(berlinDateAtOffset(2))
    );
    await parkingDialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(parkingDialog).toHaveCount(0, { timeout: 20_000 });

    await openParkplatzPanel(adminPage);
    const card = parkplatzCard(adminPage, parkTitle);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-parking-context="set"]')).toContainText('Kapazität');

    // Dispatch to the ASSIGNED employees: the dialog preselects them.
    await card.getByRole('button', { name: /^Einsatz für .* senden$/ }).click();
    const dialog = issueDialog(adminPage);
    await expect(
      dialog.locator('[data-readiness-key="tools"][data-readiness-state="unknown"]')
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      dialog.getByRole('checkbox', {
        name: `${emilName} als Empfänger auswählen`,
      })
    ).toBeChecked();
    await dialog.locator('#dispatch-note').fill(MAIN_NOTE);
    await dialog.getByRole('button', { name: 'Einsatz senden' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await employeePage.goto(`/auftraege/A7-PARK-${world.runId}`);
    await expect(
      jobDispatchSection(employeePage).locator('[data-dispatch-state="ausstehend"]')
    ).toBeVisible({ timeout: 20_000 });
    await expect(jobDispatchSection(employeePage)).toContainText(`Hinweis: ${MAIN_NOTE}`);

    // Manual cancel with reason: history stays, the worker's card disappears.
    await openDispatchPanel(adminPage);
    const unscheduledRow = unscheduledDispatchRow(adminPage, parkTitle);
    await expect(unscheduledRow).toBeVisible({ timeout: 20_000 });
    await unscheduledRow.getByRole('button', { name: 'Einsatz zurückziehen …' }).click();
    const cancelDialog = reasonDialog(adminPage, 'Einsatz zurückziehen');
    await cancelDialog
      .locator('#dispatch-reason-dialog')
      .fill('A7 Material fehlt, Einsatz wird neu geplant.');
    await cancelDialog.getByRole('button', { name: 'Einsatz zurückziehen', exact: true }).click();
    await expect(cancelDialog).toHaveCount(0, { timeout: 20_000 });

    let state = await getDispatchState(world.orgId, `A7-PARK-${world.runId}`);
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0].status).toBe('cancelled');
    expect(state.dispatches[0].eventTypes).toContain('cancelled');
    await employeePage.goto(`/auftraege/A7-PARK-${world.runId}`);
    await expect(jobDispatchSection(employeePage)).toHaveCount(0);

    // The corrected F04 contract: the Hinweistext is immutable after sending;
    // a changed instruction reaches the person via withdraw + re-send.
    await openParkplatzPanel(adminPage);
    const cardAgain = parkplatzCard(adminPage, parkTitle);
    await expect(cardAgain).toBeVisible({ timeout: 20_000 });
    await cardAgain.getByRole('button', { name: /^Einsatz für .* senden$/ }).click();
    const resendDialog = issueDialog(adminPage);
    await expect(
      resendDialog.locator('[data-readiness-key="tools"][data-readiness-state="unknown"]')
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      resendDialog.getByRole('checkbox', {
        name: `${emilName} als Empfänger auswählen`,
      })
    ).toBeChecked();
    await resendDialog.locator('#dispatch-note').fill(RESEND_NOTE);
    await resendDialog.getByRole('button', { name: 'Einsatz senden' }).click();
    await expect(resendDialog).toHaveCount(0, { timeout: 20_000 });

    state = await getDispatchState(world.orgId, `A7-PARK-${world.runId}`);
    expect(state.dispatches).toHaveLength(2);
    expect(state.dispatches[0].status).toBe('cancelled');
    expect(state.dispatches[1].status).toBe('active');
    const notes = await getDispatchRevisionNotes(world.orgId, `A7-PARK-${world.runId}`);
    expect(notes.map((entry) => entry.note)).toContain(MAIN_NOTE);
    expect(notes.map((entry) => entry.note)).toContain(RESEND_NOTE);
    await employeePage.goto(`/auftraege/A7-PARK-${world.runId}`);
    await expect(
      jobDispatchSection(employeePage).locator('[data-dispatch-state="ausstehend"]')
    ).toBeVisible({ timeout: 20_000 });
    await expect(jobDispatchSection(employeePage)).toContainText(`Hinweis: ${RESEND_NOTE}`);
  });

  test('A7-T6: Parken storniert aktive Einsätze sichtbar; der atomare Kontext nutzt das gemeinsame Grundvokabular; die fällige Wiedervorlage wird Aufgabe [P1-12-F06/P1-12-F08/P1-12-F10/P1-14-F19/P1-14-F21]', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const schedTitle = `A7 Heutiger Einsatz ${world.runId}`;
    const schedNumber = `A7-HEUTE-${world.runId}`;

    await createJob(adminPage, {
      jobNumber: schedNumber,
      title: schedTitle,
      assignEmployeeName: world.users.employee.firstName,
    });
    // A TIMED visit today: untimed jobs render in the day view's all-day
    // strip, only timed blocks are draggable onto the Parkplatz (A1-23).
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: schedNumber,
      date: A7_TODAY_ISO,
      time: '06:00',
      employeeNames: [`${world.users.employee.firstName} ${world.users.employee.lastName}`],
      overrideReason: OVERRIDE_REASON,
    });

    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, schedTitle);
    await acknowledgeDispatchOnJobPage(employeePage, schedNumber);

    // Park via the calendar drag gesture — the path that triggers the offer.
    await adminPage.goto('/kalender');
    await adminPage.getByRole('tab', { name: 'Tag', exact: true }).click();
    const block = draggablePlanningBlock(adminPage, schedTitle);
    await expect(block).toBeVisible({ timeout: 20_000 });
    const blockBox = await block.boundingBox();
    const parkplatzButton = adminPage.getByRole('button', {
      name: /^Parkplatz/,
    });
    const parkplatzBox = await parkplatzButton.boundingBox();
    if (!blockBox || !parkplatzBox) {
      throw new Error('A7-T6: park drag targets are unavailable');
    }
    await adminPage.mouse.move(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2);
    await adminPage.mouse.down();
    await adminPage.mouse.move(
      parkplatzBox.x + parkplatzBox.width / 2,
      parkplatzBox.y + parkplatzBox.height / 2,
      { steps: 15 }
    );
    await adminPage.mouse.up();
    // Dragging opens the required atomic parking context before anything is
    // persisted.
    const contextDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Parkplatz-Kontext' }),
    });
    await expect(contextDialog).toBeVisible({ timeout: 20_000 });
    // The P1-14 canonical reason vocabulary is offered in one place.
    // The reason picker is a searchable listbox (ten options); its rows are buttons.
    await contextDialog.locator('#parking-reason').click();
    const reasonListbox = adminPage.getByRole('listbox');
    await expect(reasonListbox.getByRole('button')).toHaveCount(10);
    for (const label of [
      'Kunde',
      'Material',
      'Freigabe',
      'Kapazität',
      'Zugang zum Einsatzort',
      'Abhängigkeit',
      'Fremdgewerk',
      'Sicherheit',
      'Interne Klärung',
      'Sonstiges',
    ]) {
      await expect(reasonListbox.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await reasonListbox.getByRole('button', { name: 'Freigabe', exact: true }).click();
    await contextDialog.locator('#parking-note').fill('A7 Freigabe des Eigentümers steht aus.');
    await selectFromSearchable(
      adminPage,
      contextDialog.locator('#parking-responsible'),
      world.users.buero.firstName
    );
    // A review date of TODAY is already overdue (≤ business today).
    await typeIntoDatePicker(contextDialog, 'Wiedervorlagedatum', toDatePickerDigits(A7_TODAY_ISO));
    await contextDialog.getByRole('button', { name: 'Kontext speichern' }).click();
    await expect(contextDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(visibleText(adminPage, 'Auftrag wurde geparkt.')).toBeVisible({
      timeout: 20_000,
    });

    const parking = await getParkingState(world.orgId, schedNumber);
    expect(parking.context).not.toBeNull();
    expect(parking.context!.reason).toBe('approval');
    expect(parking.context!.nextReviewDate).toBe(A7_TODAY_ISO);
    expect(parking.eventTypes).toContain('context_set');

    // Parking cancelled the acknowledged dispatch automatically and visibly.
    const state = await getDispatchState(world.orgId, schedNumber);
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0].status).toBe('cancelled');
    expect(state.dispatches[0].eventTypes).toContain('cancelled');
    const causes = await getDispatchCancellationCauses(world.orgId, schedNumber);
    expect(causes).toContain('job_parked');
    await employeePage.goto(`/auftraege/${schedNumber}`);
    await expect(jobDispatchSection(employeePage)).toHaveCount(0);
    await openDispatchPanel(adminPage);
    await expect(dispatchOccurrenceRow(adminPage, schedTitle)).toHaveCount(0);

    // The overdue Wiedervorlage is a task for the responsible person.
    await openAufgaben(bueroPage);
    const reviewGroup = bueroPage.getByTestId('attention-parking-review-tasks');
    await expect(reviewGroup).toBeVisible({ timeout: 20_000 });
    const reviewTask = reviewGroup.getByRole('link', {
      name: `Wiedervorlage für ${schedTitle} öffnen`,
      exact: true,
    });
    await expect(reviewTask).toBeVisible();
    await expect(reviewTask).toContainText(`Zuständig: ${world.users.buero.firstName}`);
  });

  test('A7-T7: Kundenzusage — Ankunftsfenster, vier Kanäle, kein Versand; nach dem Verschieben sichtbare Abweichung und Rückzug mit Grund [P1-12-F13/P1-12-F14]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const commitTitle = `A7 Zusagebesuch ${world.runId}`;
    const commitNumber = `A7-ZUSAGE-${world.runId}`;

    await createJob(adminPage, {
      jobNumber: commitNumber,
      title: commitTitle,
      clientName: `A7 Kundin ${world.runId}`,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: commitNumber,
      date: COMMIT_DATE,
      time: '06:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, commitTitle);

    const row = dispatchOccurrenceRow(adminPage, commitTitle);
    await row.getByRole('button', { name: 'Zusage erfassen', exact: true }).click();
    const dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Kundenzusage erfassen' }),
    });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Recording documents an internal note only — the app sends nothing.
    await expect(dialog).toContainText('Es wird keine Nachricht versendet.');
    // Exactly the four catalog channels are offered.
    await dialog.locator('#commitment-source').click();
    const sourceOptions = adminPage.getByRole('option');
    await expect(sourceOptions).toHaveCount(4);
    for (const label of [
      'Telefonisch vereinbart',
      'Vor Ort vereinbart',
      'Schriftlich vereinbart (manuell erfasst)',
      'Sonstige Vereinbarung',
    ]) {
      await expect(adminPage.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    await adminPage.getByRole('option', { name: 'Vor Ort vereinbart', exact: true }).click();
    // The optional arrival window covers the visit's 06:00 start.
    await typeIntoTimeInput(dialog, 'commitment-window-start', '0600');
    await typeIntoTimeInput(dialog, 'commitment-window-end', '0800');
    await dialog.getByRole('button', { name: 'Zusage erfassen' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await expect(row.locator('[data-commitment-mismatch="false"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(row).toContainText(`Zusage: ${formatGermanDate(COMMIT_DATE)}, 06:00–08:00 Uhr`);
    let commitments = await getCommitmentFacts(world.orgId, commitNumber);
    expect(commitments).toHaveLength(1);
    expect(commitments[0].status).toBe('active');
    expect(commitments[0].source).toBe('vor_ort');
    expect(commitments[0].committedDate).toBe(COMMIT_DATE);
    expect(commitments[0].windowStartTime?.slice(0, 5)).toBe('06:00');
    expect(commitments[0].windowEndTime?.slice(0, 5)).toBe('08:00');
    // The worker sees the internal promise on their card.
    await employeePage.goto(`/auftraege/${commitNumber}`);
    await expect(jobDispatchSection(employeePage)).toContainText('Dem Kunden zugesagt');
    await expect(jobDispatchSection(employeePage)).toContainText('06:00–08:00 Uhr');

    // Moving the visit leaves the commitment untouched and shows the
    // mismatch visibly.
    await editPlannedCalendarOccurrence(adminPage, {
      title: commitTitle,
      calendarDate: COMMIT_DATE,
      scope: 'one',
      date: COMMIT_MOVED_DATE,
      overrideReason: OVERRIDE_REASON,
    });
    await openDispatchPanel(adminPage);
    const movedRow = dispatchOccurrenceRow(adminPage, commitTitle);
    await expect(movedRow.locator('[data-commitment-mismatch="true"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(movedRow).toContainText('weicht vom Plan ab');
    commitments = await getCommitmentFacts(world.orgId, commitNumber);
    expect(commitments).toHaveLength(1);
    expect(commitments[0].committedDate).toBe(COMMIT_DATE);

    // Explicit resolution: withdraw WITH reason; no customer notification.
    await movedRow.getByRole('button', { name: 'Zusage zurückziehen …' }).click();
    const withdrawDialog = reasonDialog(adminPage, 'Kundenzusage zurückziehen');
    await expect(withdrawDialog).toContainText('Der Kunde wird dadurch nicht benachrichtigt.');
    await withdrawDialog
      .locator('#dispatch-reason-dialog')
      .fill('A7 Kundin hat den Termin telefonisch abgesagt.');
    await withdrawDialog.getByRole('button', { name: 'Zusage zurückziehen', exact: true }).click();
    await expect(withdrawDialog).toHaveCount(0, { timeout: 20_000 });

    commitments = await getCommitmentFacts(world.orgId, commitNumber);
    expect(commitments).toHaveLength(1);
    expect(commitments[0].status).toBe('withdrawn');
    expect(commitments[0].withdrawalReason).toBe('A7 Kundin hat den Termin telefonisch abgesagt.');
    await expect(
      movedRow.getByRole('button', { name: 'Zusage erfassen', exact: true })
    ).toBeVisible({ timeout: 20_000 });
    await expect(movedRow.locator('[data-commitment-mismatch]')).toHaveCount(0);
  });

  test('A7-T8: Batch-Auswahl kennt nur die Zukunft; ganztägige Besuche brauchen eine Tagesverschiebung — alles oder nichts [P1-12-F15/P1-12-F17]', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const todayTitle = `A7 Ganztag heute ${world.runId}`;
    const alldayTitle = `A7 Ganztagsbesuch ${world.runId}`;

    await createJob(adminPage, {
      jobNumber: `A7-GT-HEUTE-${world.runId}`,
      title: todayTitle,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: `A7-GT-HEUTE-${world.runId}`,
      date: A7_TODAY_ISO,
      durationDays: 1,
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });
    await createJob(adminPage, {
      jobNumber: `A7-GT-${world.runId}`,
      title: alldayTitle,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: `A7-GT-${world.runId}`,
      date: ALLDAY_DATE,
      durationDays: 1,
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    await openDispatchPanel(adminPage);
    const panel = dispatchPanel(adminPage);
    await panel.getByRole('button', { name: 'Verschieben', exact: true }).click();

    // Only FUTURE visits are selectable: today's all-day visit is offered as
    // a row but its checkbox stays disabled.
    const todayRow = dispatchOccurrenceRow(adminPage, todayTitle);
    await expect(todayRow).toBeVisible({ timeout: 20_000 });
    await expect(todayRow.getByRole('checkbox')).toBeDisabled();

    const alldayRow = dispatchOccurrenceRow(adminPage, alldayTitle);
    await alldayRow.getByRole('checkbox').check();
    await expect(panel.getByText('1 Besuch ausgewählt', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await panel.locator('#batch-day-shift').fill('0');
    await panel.locator('#batch-reason').fill('A7 Uhrzeitverschiebung ohne Tageswechsel.');
    // A zero shift without a new time is no move at all: the preview stays
    // unreachable even with a visit selected and a reason given.
    await expect(panel.getByRole('button', { name: 'Auswirkungen prüfen' })).toBeDisabled();

    // All-or-nothing rejection: an all-day visit with a pure time shift is
    // refused with the exact German message and NOTHING moves.
    await typeIntoTimeInput(panel, 'batch-new-time', '0700');
    await panel.getByRole('button', { name: 'Auswirkungen prüfen' }).click();
    await expect(
      panel.getByText('Ganztägige Besuche benötigen eine Verschiebung um mindestens einen Tag.')
    ).toBeVisible({ timeout: 20_000 });
    const alldayOccurrences = await getJobOccurrences(world.orgId, `A7-GT-${world.runId}`);
    expect(alldayOccurrences).toHaveLength(1);
    expect(alldayOccurrences[0].startDate).toBe(ALLDAY_DATE);
  });

  test('A7-T9: Batch mit neuer Uhrzeit — Vorschau je Termin alt und neu, Konflikte nur mit Grund, Serientermine werden Einzel-Ausnahmen [P1-12-F15/P1-12-F16/P1-12-F17]', async ({
    adminPage,
    world,
  }) => {
    const organizationTimeStart = requireChainedValue(organizationTimeBaseline, {
      test: 'A7-T9',
      needs: 'the organization time-entry baseline captured before A7 dispatches',
      grep: 'A7-T1|A7-T9',
      suite: 'audit',
    });
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const seriesTitle = `A7 Serienbesuch ${world.runId}`;
    const seriesNumber = `A7-SERIE-${world.runId}`;

    await createJob(adminPage, {
      jobNumber: seriesNumber,
      title: seriesTitle,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: seriesNumber,
      date: SERIES_DATE,
      time: '06:00',
      employeeNames: [employeeName],
      recurrence: { frequency: 'daily', count: 2 },
      overrideReason: OVERRIDE_REASON,
    });
    const before = await getJobOccurrences(world.orgId, seriesNumber);
    expect(before).toHaveLength(2);
    expect(before.every((occurrence) => occurrence.seriesId !== null)).toBe(true);
    expect(before.every((occurrence) => !occurrence.isException)).toBe(true);
    const seriesId = before[0].seriesId;

    await openDispatchPanel(adminPage);
    const panel = dispatchPanel(adminPage);
    await panel.getByRole('button', { name: 'Verschieben', exact: true }).click();
    const rows = panel.locator('[data-dispatch-occurrence]').filter({ hasText: seriesTitle });
    // The overview loads asynchronously after the panel opens — wait for the
    // series rows before touching any checkbox.
    await expect(rows).not.toHaveCount(0, { timeout: 20_000 });
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    for (const row of await rows.all()) {
      await row.getByRole('checkbox').check();
    }
    await expect(panel.getByText('2 Besuche ausgewählt', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // Whole days AND a new time together.
    await panel.locator('#batch-day-shift').fill('1');
    await typeIntoTimeInput(panel, 'batch-new-time', '0800');
    await panel
      .locator('#batch-reason')
      .fill('A7 Krankheitsbedingte Umplanung mit neuer Anfahrtszeit.');
    await panel.getByRole('button', { name: 'Auswirkungen prüfen' }).click();
    const preview = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Verschiebung prüfen' }),
    });
    await expect(preview).toBeVisible({ timeout: 30_000 });

    // The preview names each occurrence with its OLD and NEW instant, ordered
    // by the old start (the server sorts the items deterministically).
    const previewItems = preview.locator('[data-batch-preview-item]');
    await expect(previewItems).toHaveCount(2);
    const expectedRows: Array<{ oldDate: string; newDate: string }> = [
      { oldDate: SERIES_DATE, newDate: SERIES_SHIFTED_FIRST },
      { oldDate: SERIES_SECOND_SOURCE_DATE, newDate: SERIES_SHIFTED_SECOND },
    ];
    const renderedPreviewItems = await previewItems.all();
    for (let index = 0; index < renderedPreviewItems.length; index += 1) {
      const item = renderedPreviewItems[index];
      await expect(item).toContainText(seriesTitle);
      await expect(item).toContainText(
        `${shortGermanDayMonth(expectedRows[index].oldDate)}, 06:00 Uhr`
      );
      await expect(item).toContainText('→');
      await expect(item).toContainText(
        `${shortGermanDayMonth(expectedRows[index].newDate)}, 08:00 Uhr`
      );
    }
    // Capacity conflicts (no schedules in this world) are announced with the
    // reason requirement before anything moves.
    await expect(preview.getByText(/Planungshinweis/)).toBeVisible();

    await preview.getByRole('button', { name: 'Jetzt verschieben' }).click();
    const warning = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Planungshinweise prüfen' }),
    });
    await expect(warning).toBeVisible({ timeout: 30_000 });
    // Conflicts override ONLY with a sufficient reason.
    await warning.locator('#planning-warning-reason').fill('kurz');
    await expect(warning.getByRole('button', { name: 'Mit Begründung speichern' })).toBeDisabled();
    await warning
      .locator('#planning-warning-reason')
      .fill('A7 Umplanung betrieblich abgestimmt und bestätigt.');
    await warning.getByRole('button', { name: 'Mit Begründung speichern' }).click();
    await expect(warning).toHaveCount(0, { timeout: 30_000 });
    await expect(preview).toHaveCount(0, { timeout: 30_000 });

    // All-or-nothing execution: both occurrences moved one day to 08:00,
    // both became single exceptions of the SAME series, history retained.
    const after = await getJobOccurrences(world.orgId, seriesNumber);
    expect(after).toHaveLength(2);
    const localStarts = after
      .map((occurrence) =>
        occurrence.startAt ? formatBerlinLocalDateTime(occurrence.startAt).slice(0, 16) : ''
      )
      .sort();
    expect(localStarts).toEqual([
      `${SERIES_SHIFTED_FIRST}T08:00`,
      `${SERIES_SHIFTED_SECOND}T08:00`,
    ]);
    expect(after.every((occurrence) => occurrence.isException)).toBe(true);
    expect(after.every((occurrence) => occurrence.seriesId === seriesId)).toBe(true);
    const history = await getBatchPlanningHistory(
      world.orgId,
      after.map((occurrence) => occurrence.id)
    );
    // Every occurrence keeps its own edited history entry from the batch …
    expect(history.editedWithBatchRequest.sort()).toEqual(
      after.map((occurrence) => occurrence.id).sort()
    );
    // … and one atomic batch marker names exactly the moved set.
    expect(history.batchEventOccurrenceIdSets).toContainEqual(
      after.map((occurrence) => occurrence.id).sort()
    );

    // Closing bracket for the whole session: dispatching, confirming,
    // challenging, parking, committing, and batch moving never created time.
    expect(await getOrganizationTimeEntryCount(world.orgId)).toBe(organizationTimeStart);
  });
});
