import { expect, type Locator, type Page } from '@playwright/test';

import { formatBerlinLocalDate, getLocalDayStart } from '../../../lib/date-time/berlin';
import { createAdminClient } from '../../golden/support/db/shared';
import { getJobIdByNumber, seedDeclaredWorkDependency } from '../../golden/support/db/work';
import { clockInLauncher, runningClockLauncher } from '../../golden/support/steps/time-tracking';
import type { TestUser, TestWorld } from '../../golden/support/world';
import { todayJobNumber } from './offline-today';
import { unsentSection } from './time-outbox';

// The office's side of a visit without signal (decision record 0010, "Replay
// rechecks everything"): what the office changes while a phone is offline,
// the server's record of what the phone sent, and how the clock names what
// the server refused. The spec passes data; copy, table and function names
// live here.

export const OFFLINE_VISIT_COPY = {
  conflict: 'Konflikt',
  resend: 'Erneut senden',
  /** Why a stopped chain was not recorded, by the server's code (components/clock-unsent-list.tsx). */
  officeChanged: /^Das Büro hat inzwischen etwas geändert/,
  closedPeriod: /^Der Monat dieser Zeiten ist bereits abgeschlossen/,
  noAccess: /keine Berechtigung mehr\.$/,
} as const;

/**
 * Opens the clock's sheet, running or not, and answers its section of the events the phone holds
 * unsent. A stopped chain shows the server's clock, so the launcher is the server's.
 */
export async function openUnsentSection(page: Page, running: boolean): Promise<Locator> {
  await (running ? runningClockLauncher(page) : clockInLauncher(page)).click();
  const section = unsentSection(page);
  await expect(section).toBeVisible();
  return section;
}

/** The sentence of the unsent section that says why the chain stopped. */
export function unsentReason(section: Locator, reason: RegExp): Locator {
  return section.getByText(reason);
}

/** „Erneut senden“ of a refused chain. */
export function unsentResendButton(section: Locator): Locator {
  return section.getByRole('button', { name: OFFLINE_VISIT_COPY.resend, exact: true });
}

/** The office declares that the day's job waits for a delivery: no work on it may start. */
export async function blockJobStart(world: TestWorld, description: string): Promise<void> {
  await seedDeclaredWorkDependency({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    jobId: await getJobIdByNumber(world.orgId, todayJobNumber(world)),
    kind: 'delivery',
    description,
    effect: 'blocks_start',
  });
}

/** The current Berlin month as the bounds of a time period. */
function currentMonth(): { start: string; end: string } {
  const today = formatBerlinLocalDate(getLocalDayStart(new Date()));
  const [year, month] = today.split('-').map(Number);
  if (year === undefined || month === undefined) throw new Error(`Unreadable Berlin date ${today}.`);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = today.slice(0, 8);
  return { start: `${prefix}01`, end: `${prefix}${String(lastDay).padStart(2, '0')}` };
}

/**
 * Closes the current month of the world's organization: no time may be recorded in it. The rows
 * are what closing writes, with an empty calculation: the refusal reads only the period's state.
 */
export async function closeCurrentMonth(world: TestWorld): Promise<void> {
  const admin = createAdminClient();
  const { start, end } = currentMonth();
  const actorId = world.users.admin.id;
  const fingerprint = 'f'.repeat(64);
  const { data: period } = await admin
    .from('time_periods')
    .insert({
      organization_id: world.orgId,
      period_start_date: start,
      period_end_date: end,
      prepared_by: actorId,
    })
    .select('id')
    .single()
    .throwOnError();
  const { data: calculation } = await admin
    .from('time_period_calculations')
    .insert({
      organization_id: world.orgId,
      period_id: period.id,
      version: 1,
      source_fingerprint: fingerprint,
      generated_by: actorId,
    })
    .select('id')
    .single()
    .throwOnError();
  const { data: closeVersion } = await admin
    .from('time_period_close_versions')
    .insert({
      organization_id: world.orgId,
      period_id: period.id,
      calculation_id: calculation.id,
      version: 1,
      source_fingerprint: fingerprint,
      opening_balance_total_minutes: 0,
      period_delta_total_minutes: 0,
      closing_balance_total_minutes: 0,
      closed_by: actorId,
    })
    .select('id')
    .single()
    .throwOnError();
  await admin
    .from('time_periods')
    .update({
      state: 'closed',
      current_calculation_id: calculation.id,
      current_close_version_id: closeVersion.id,
    })
    .eq('organization_id', world.orgId)
    .eq('id', period.id)
    .throwOnError();
}

/** Takes back `closeCurrentMonth` with its rows, so the other journeys of the world record time again. */
export async function reopenCurrentMonth(world: TestWorld): Promise<void> {
  const { start } = currentMonth();
  await createAdminClient()
    .from('time_periods')
    .delete()
    .eq('organization_id', world.orgId)
    .eq('period_start_date', start)
    .throwOnError();
}

/** The office removes a member through the function the member list's removal calls. */
export async function removeMember(world: TestWorld, member: TestUser): Promise<void> {
  await createAdminClient()
    .rpc('remove_member_with_time_capture', {
      p_organization_id: world.orgId,
      p_target_user_id: member.id,
      p_actor_id: world.users.admin.id,
      p_operation_id: crypto.randomUUID(),
    })
    .throwOnError();
}

type RecordedClock = {
  /** Every clock operation the server recorded for the person, oldest first: its kind, and whether a phone captured it. */
  operations: { kind: string; captured: boolean }[];
  /** The person's sessions, oldest first, with their segments. */
  sessions: {
    open: boolean;
    /** The session starts at the captured time of the operation that started it. */
    startsAtCapture: boolean;
    segments: { kind: string; onJob: boolean }[];
  }[];
};

async function recordedClock(world: TestWorld, user: TestUser): Promise<RecordedClock> {
  const admin = createAdminClient();
  const { data: operations } = await admin
    .from('time_operations')
    .select('operation_kind, captured_at, resulting_session_id, employee_records!inner(user_id)')
    .eq('organization_id', world.orgId)
    .eq('employee_records.user_id', user.id)
    .order('created_at')
    .throwOnError();
  const { data: sessions } = await admin
    .from('time_sessions')
    .select('id, started_at, ended_at')
    .eq('organization_id', world.orgId)
    .eq('user_id', user.id)
    .order('started_at')
    .throwOnError();
  const { data: segments } = await admin
    .from('time_segments')
    .select('session_id, kind, job_id')
    .eq('organization_id', world.orgId)
    .in(
      'session_id',
      sessions.map((session) => session.id),
    )
    .order('started_at')
    .throwOnError();
  return {
    operations: operations.map((operation) => ({
      kind: operation.operation_kind,
      captured: operation.captured_at !== null,
    })),
    sessions: sessions.map((session) => {
      const start = operations.find((operation) => operation.resulting_session_id === session.id);
      return {
        open: session.ended_at === null,
        startsAtCapture:
          start?.captured_at != null && Date.parse(start.captured_at) === Date.parse(session.started_at),
        segments: segments
          .filter((segment) => segment.session_id === session.id)
          .map((segment) => ({ kind: segment.kind, onJob: segment.job_id !== null })),
      };
    }),
  };
}

/** Waits until the server holds exactly this record of the person's clock. */
export async function expectRecordedClock(
  world: TestWorld,
  user: TestUser,
  expected: RecordedClock,
): Promise<void> {
  await expect
    .poll(() => recordedClock(world, user), {
      message: "The server holds each of the phone's recorded clock actions once, and nothing else",
    })
    .toEqual(expected);
}
