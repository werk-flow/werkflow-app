import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';

import { onCallWeek } from './rules';
import { onCallReadSchema, type OnCallOverview, type OnCallRead, type OnCallWeekView } from './types';

// The Bereitschaft readers (werk-flow/werkflow-planning#469). The caller of a
// reader has established the organization and the role: the dashboard for
// every member, the week list for Admin and Büro. Every read filters by that
// organization; the office read alone carries the history and the people.

/** How far ahead the dashboard shows the coming shifts. */
const OVERVIEW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

async function readShifts(
  organizationId: string,
  from: Date,
  until: Date,
  forOffice: boolean,
): Promise<ActionResult<{ read: OnCallRead }, 'load_failed'>> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    'read_on_call_shifts',
    rpcArgs('read_on_call_shifts', {
      p_organization_id: organizationId,
      p_from: from.toISOString(),
      p_until: until.toISOString(),
      p_for_office: forOffice,
    }),
  );
  if (error) {
    logError('readShifts: on-call read failed', error);
    return { success: false, error: 'load_failed' };
  }
  const parsed = onCallReadSchema.safeParse(data);
  if (!parsed.success) {
    logError('readShifts: on-call read had an unknown shape', parsed.error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, read: parsed.data };
}

/** Who is on call now and in the coming days, and the caller's own personnel record to find their shifts. */
export async function readOnCallOverview(
  organizationId: string,
  userId: string,
): Promise<ActionResult<{ overview: OnCallOverview }, 'load_failed'>> {
  const now = new Date();
  const [shifts, ownRecord] = await Promise.all([
    readShifts(organizationId, now, new Date(now.getTime() + OVERVIEW_DAYS * DAY_MS), false),
    createSupabaseAdminClient()
      .from('employee_records')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (!shifts.success) return shifts;
  if (ownRecord.error) {
    logError('readOnCallOverview: own record read failed', ownRecord.error);
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    overview: { shifts: shifts.read.shifts, ownEmployeeRecordId: ownRecord.data?.id ?? null },
  };
}

/** The office's week: its shifts with their history, the shifts running now and the people to plan. */
export async function readOnCallWeek(
  organizationId: string,
  dayInWeek: string | null,
): Promise<ActionResult<{ week: OnCallWeekView }, 'load_failed'>> {
  const week = onCallWeek(dayInWeek ?? getBusinessTodayIso());
  const now = new Date();
  const [shown, running] = await Promise.all([
    readShifts(organizationId, week.from, week.until, true),
    readShifts(organizationId, now, new Date(now.getTime() + 1), true),
  ]);
  if (!shown.success) return shown;
  if (!running.success) return running;
  return {
    success: true,
    week: {
      monday: week.monday,
      shifts: shown.read.shifts,
      running: running.read.shifts.filter((shift) => shift.cancelledAt === null),
      people: shown.read.people,
    },
  };
}
