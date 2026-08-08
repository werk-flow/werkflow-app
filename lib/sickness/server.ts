import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ApprovedAbsenceSpan } from '@/lib/personnel/targets';
import { toSicknessReport, type SicknessReport } from './types';

// Server-only shared loaders for the sickness domain. Server actions and the
// target loaders consume these; nothing here performs authorization — callers
// resolve their own authority first.

/** All sickness reports of one employee record, newest first. */
export async function loadSicknessReportsForRecord(
  organizationId: string,
  employeeRecordId: string
): Promise<SicknessReport[] | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('sickness_reports')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('employee_record_id', employeeRecordId)
    .order('start_date', { ascending: false });

  if (error) {
    console.error('Failed to load sickness reports:', error);
    return null;
  }
  return (data ?? []).map(toSicknessReport);
}

/**
 * Active sickness spans per employee record intersecting a date window — the
 * second variant of the `resolveDailyTarget` absence input (P1-08). Only
 * `reported` rows qualify; cancelled reports never reach targets. Open-ended
 * reports (end_date null) are clamped to the window end: while a report is
 * open, every day from its start counts as absent.
 */
export async function loadActiveSicknessSpansByRecord(
  organizationId: string,
  windowStartIso: string,
  windowEndIso: string,
  /** Narrows the read to one record (single-person target surfaces). */
  employeeRecordId?: string
): Promise<Map<string, ApprovedAbsenceSpan[]>> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from('sickness_reports')
    .select('employee_record_id, start_date, end_date, day_portion')
    .eq('organization_id', organizationId)
    .eq('status', 'reported')
    .lte('start_date', windowEndIso)
    .or(`end_date.gte.${windowStartIso},end_date.is.null`);
  if (employeeRecordId) {
    query = query.eq('employee_record_id', employeeRecordId);
  }
  const { data, error } = await query;

  if (error) {
    // Absence must never break the target surfaces: degrade to "no absence"
    // (targets stay pre-P1-08 correct) and log for diagnosis.
    console.error('Failed to load active sickness spans:', error);
    return new Map();
  }

  const spansByRecord = new Map<string, ApprovedAbsenceSpan[]>();
  for (const row of data ?? []) {
    const spans = spansByRecord.get(row.employee_record_id) ?? [];
    spans.push({
      type: 'sickness',
      startDate: row.start_date,
      // Open-ended: absent until further notice, honestly bounded to the
      // requested window instead of pretending a known end date exists.
      endDate: row.end_date ?? windowEndIso,
      dayPortion: row.day_portion as ApprovedAbsenceSpan['dayPortion'],
    });
    spansByRecord.set(row.employee_record_id, spans);
  }
  return spansByRecord;
}

/**
 * Whether the user has an active sickness report covering the date in this
 * organization (clock-in contradiction NOTICE; resolved at action time).
 * Unlike vacation this never blocks — a recovered person clocking in early is
 * reality, not an error — so callers surface it as a visible hint only.
 */
export async function hasActiveSicknessOn(
  organizationId: string,
  userId: string,
  dateIso: string
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (recordError) {
    console.error('Failed to load record for sickness clock check:', recordError);
    return false;
  }
  if (!record) return false;

  const { data, error } = await admin
    .from('sickness_reports')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('employee_record_id', record.id)
    .eq('status', 'reported')
    .lte('start_date', dateIso)
    .or(`end_date.gte.${dateIso},end_date.is.null`)
    .limit(1);
  if (error) {
    // Fail open: a transient read failure must not degrade time capture; the
    // notice is informational and the office sees contradictions either way.
    console.error('Failed sickness clock check:', error);
    return false;
  }
  return (data ?? []).length > 0;
}
