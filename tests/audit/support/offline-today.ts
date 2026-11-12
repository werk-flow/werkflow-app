import { expect, type Locator, type Page } from '@playwright/test';

import { formatBerlinLocalDate, getLocalDayStart } from '../../../lib/date-time/berlin';
import { createAdminClient } from '../../golden/support/db/shared';
import {
  getJobIdByNumber,
  seedJob,
  seedJobAssignment,
  seedJobInstructionItem,
} from '../../golden/support/db/work';
import { confirmed } from '../../golden/support/steps/shared';
import type { TestWorld } from '../../golden/support/world';

// The today snapshot a phone keeps without signal
// (components/auftraege/work-pack/offline-today.tsx): seeding, locators and
// reads of the device store. The spec passes data; copy and storage names
// live here.

/** The IndexedDB database and the cross-tab wipe signal of lib/field-sync/device/today-wipe.ts. */
const TODAY_DATABASE = 'werkflow-today';
const TODAY_WIPE_KEY = 'werkflow:today-wiped';
/** The device claim of lib/field-sync/device/today-wipe.ts. */
const TODAY_HOLDER_KEY = 'werkflow:today-holder';

/** The number of the job `seedTodayAssignment` creates. */
export function todayJobNumber(world: TestWorld): string {
  return `HEUTE-${world.runId}`;
}

/**
 * A job assigned to the employee with a visit on the current Berlin day that
 * names the employee, and one instruction, numbered `todayJobNumber(world)`.
 */
export async function seedTodayAssignment(
  world: TestWorld,
  input: { title: string; instruction: string },
): Promise<void> {
  const admin = createAdminClient();
  const jobNumber = todayJobNumber(world);
  const actorId = world.users.admin.id;
  const jobId = await seedJob({ orgId: world.orgId, actorId, jobNumber, title: input.title });
  await seedJobAssignment({ orgId: world.orgId, actorId, jobId, userId: world.users.employee.id });
  await seedJobInstructionItem({ orgId: world.orgId, actorId, jobId, content: input.instruction });
  const { data: record } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', world.orgId)
    .eq('user_id', world.users.employee.id)
    .single()
    .throwOnError();
  const dayStart = getLocalDayStart(new Date());
  const occurrenceId = crypto.randomUUID();
  await admin
    .from('planning_occurrences')
    .insert({
      id: occurrenceId,
      organization_id: world.orgId,
      entry_kind: 'job_visit',
      job_id: jobId,
      created_by: actorId,
      time_kind: 'all_day',
      start_date: formatBerlinLocalDate(dayStart),
      end_date_exclusive: formatBerlinLocalDate(new Date(dayStart.getTime() + 36 * 3_600_000)),
    })
    .throwOnError();
  await admin
    .from('planning_occurrence_assignments')
    .insert({
      organization_id: world.orgId,
      occurrence_id: occurrenceId,
      employee_record_id: record.id,
      assigned_by: actorId,
    })
    .throwOnError();
}

/** Changes the text of the job's instruction, as the office does while the field worker is out. */
export async function changeInstruction(world: TestWorld, content: string): Promise<void> {
  const jobId = await getJobIdByNumber(world.orgId, todayJobNumber(world));
  await createAdminClient()
    .from('job_instruction_items')
    .update({ content })
    .eq('organization_id', world.orgId)
    .eq('job_id', jobId)
    .throwOnError();
}

const OFFLINE_TODAY_COPY = {
  list: 'Heute',
  backToList: 'Alle Einsätze von heute',
} as const;

/** The offline view of the day's list or one pack (`data-testid="offline-today"`). */
function offlineToday(page: Page): Locator {
  return page.getByRole('main').getByTestId('offline-today');
}

/** The heading of the day's list without signal. */
export function offlineTodayList(page: Page): Locator {
  return offlineToday(page).getByRole('heading', { level: 1, name: OFFLINE_TODAY_COPY.list });
}

/** The link from an offline pack back to the day's list. */
export function offlineBackToList(page: Page): Locator {
  return offlineToday(page).getByRole('link', { name: OFFLINE_TODAY_COPY.backToList });
}

/** The day's list entry of one job, by its title. */
export function offlineListEntry(page: Page, title: string): Locator {
  return confirmed(offlineToday(page).getByRole('link', { name: new RegExp(title) }));
}

/** A text of the offline pack, such as an instruction. */
export function offlinePackText(page: Page, text: string): Locator {
  return offlineToday(page).getByText(text);
}

/** The line every offline view starts with: „Offline · Stand HH:MM“. */
export function offlineStand(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: /^Offline · Stand \d{2}:\d{2}$/ });
}

/** The stored snapshot as JSON text, or null when the device holds none. */
async function readTodayOnPage(page: Page): Promise<string | null> {
  return page.evaluate(async (name) => {
    const names = (await indexedDB.databases()).map((info) => info.name);
    if (!names.includes(name)) return null;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('today')) return null;
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction('today').objectStore('today').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return value === undefined ? null : JSON.stringify(value);
    } finally {
      database.close();
    }
  }, TODAY_DATABASE);
}

/** Waits until the device store holds a snapshot that names every text. */
export async function waitForTodayOnDevice(page: Page, texts: readonly string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const stored = (await readTodayOnPage(page)) ?? '';
        return texts.every((text) => stored.includes(text));
      },
      { message: `The device store holds today's snapshot with ${texts.join(', ')}` },
    )
    .toBe(true);
}

/** Asserts that the device keeps no today database at all. */
export async function expectNoTodayOnDevice(page: Page): Promise<void> {
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((info) => info.name));
  expect(names).not.toContain(TODAY_DATABASE);
  expect(await page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY)).toBeNull();
}

/** What a sign-out in another tab does to the device: the shared wipe signal and the deleted database. */
export async function wipeTodayFromPage(page: Page): Promise<void> {
  await page.evaluate(
    async ({ name, key }) => {
      localStorage.setItem(key, `spec-${Date.now()}`);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
    { name: TODAY_DATABASE, key: TODAY_WIPE_KEY },
  );
}
