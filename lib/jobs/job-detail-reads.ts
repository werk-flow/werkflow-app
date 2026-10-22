import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { toClientContact, toClientSite, type ClientContact, type ClientSite } from '@/lib/clients/types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { formatBerlinLocalDate, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { formatEmployeeRecordName } from '@/lib/personnel/types';
import type { AdminClient } from '@/lib/supabase/admin';
import {
  JOB_FORM_VISIT_LIMIT,
  jobFormEditsSchedule,
  namesJobSchedule,
  type JobVisit,
  type JobVisitPlan,
} from './visit-schedule';

// Site/contact context and the scheduled visit count for the job detail
// surfaces (office and assigned field workers alike). Null when a read
// failed: a missing site or contact would look like none, and a missing count
// would offer a schedule edit the job action refuses.
export async function loadJobDetailRelations(
  admin: AdminClient,
  orgId: string,
  job: { id: string; site_id: string | null; contact_id: string | null },
): Promise<{ site: ClientSite | null; contact: ClientContact | null; scheduledVisitCount: number } | null> {
  const siteId = job.site_id;
  const contactId = job.contact_id;
  const [siteResult, contactResult, visitCountResult] = await Promise.all([
    siteId
      ? admin.from('client_sites').select('*').eq('organization_id', orgId).eq('id', siteId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contactId
      ? admin
          .from('client_contacts')
          .select('*')
          .eq('organization_id', orgId)
          .eq('id', contactId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    countScheduledVisits(admin, orgId, job.id),
  ]);
  const error = siteResult.error ?? contactResult.error ?? visitCountResult.error;
  if (error) {
    logReadFailure('loadJobDetailRelations: site, contact or visit count failed', error);
    return null;
  }

  return {
    site: siteResult.data ? toClientSite(siteResult.data) : null,
    contact: contactResult.data ? toClientContact(contactResult.data) : null,
    scheduledVisitCount: visitCountResult.count ?? 0,
  };
}

const VISIT_SELECT =
  'id, start_at, end_at, start_date, people:planning_occurrence_assignments(employee_records(first_name, last_name))';

function countScheduledVisits(admin: AdminClient, orgId: string, jobId: string) {
  return admin
    .from('planning_occurrences')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('job_id', jobId)
    .eq('status', 'scheduled');
}

/**
 * The job's scheduled visits for the job form: their number, and the first
 * upcoming ones with their people. A timed visit starts at an instant, an
 * all-day visit on a date, so each kind is read in start order and the two
 * are merged. Null when a read failed.
 */
export async function readJobVisitPlan(
  admin: AdminClient,
  orgId: string,
  jobId: string,
): Promise<JobVisitPlan | null> {
  const scheduledVisits = () =>
    admin
      .from('planning_occurrences')
      .select(VISIT_SELECT, { count: 'exact' })
      .eq('organization_id', orgId)
      .eq('job_id', jobId)
      .eq('status', 'scheduled');
  const [totalResult, timedResult, allDayResult] = await Promise.all([
    countScheduledVisits(admin, orgId, jobId),
    scheduledVisits()
      .gte('start_at', new Date().toISOString())
      .order('start_at')
      .order('id')
      .limit(JOB_FORM_VISIT_LIMIT),
    scheduledVisits()
      .gte('start_date', getBusinessTodayIso())
      .order('start_date')
      .order('id')
      .limit(JOB_FORM_VISIT_LIMIT),
  ]);
  const error = totalResult.error ?? timedResult.error ?? allDayResult.error;
  if (error || !timedResult.data || !allDayResult.data) {
    logReadFailure('readJobVisitPlan: visits failed', { code: error?.code ?? 'no_rows' });
    return null;
  }
  const upcoming = [...timedResult.data, ...allDayResult.data]
    .flatMap((row): JobVisit[] => {
      const date = row.start_at ? formatBerlinLocalDate(row.start_at) : row.start_date;
      if (!date) return [];
      const people = row.people.map(({ employee_records: record }) =>
        formatEmployeeRecordName({ firstName: record.first_name, lastName: record.last_name }),
      );
      return [{ id: row.id, date, startAt: row.start_at, endAt: row.end_at, people }];
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) || (left.startAt ?? '').localeCompare(right.startAt ?? ''),
    )
    .slice(0, JOB_FORM_VISIT_LIMIT);
  return {
    total: totalResult.count ?? 0,
    upcomingTotal: (timedResult.count ?? 0) + (allDayResult.count ?? 0),
    upcoming,
  };
}

/**
 * Refuses a schedule edit of a job with several scheduled visits: the job's
 * schedule columns move only its legacy visit, so such a job is planned on
 * the Plantafel. Null when the edit may go ahead.
 */
export async function refuseScheduleOfSeveralVisits(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string;
  changes: Parameters<typeof namesJobSchedule>[0];
}): Promise<ActionFailure<'job_has_several_visits' | 'load_failed'> | null> {
  if (!namesJobSchedule(input.changes)) return null;
  const { count, error } = await countScheduledVisits(input.admin, input.orgId, input.jobId);
  if (error) {
    logReadFailure('refuseScheduleOfSeveralVisits: visit count failed', { code: error.code });
    return { success: false, error: 'load_failed' };
  }
  return jobFormEditsSchedule(count ?? 0) ? null : { success: false, error: 'job_has_several_visits' };
}
