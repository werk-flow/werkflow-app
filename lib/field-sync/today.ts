import 'server-only';

import { createHash } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import { formatSiteAddress } from '@/lib/clients/types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { formatBerlinLocalDate, getLocalDayEnd, getLocalDayStart } from '@/lib/date-time/berlin';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { FieldSyncToday, FieldSyncTodayAssignment } from './today-snapshot';

// The server side of the today snapshot (decision record 0010, "Device data"):
// the caller's own scheduled job visits on the current Berlin day, limited to
// jobs the caller is assigned to, which is the gate of the online field work
// pack. Every field below is named on purpose: the snapshot is a subset of
// what that pack shows its assignee, so an office-only column (a customer's
// e-mail or number, site or contact notes, an internal job field) never
// reaches a phone. Each read is scoped to the caller's active organization.

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type Caller = { userId: string; organizationId: string };
type Visit = FieldSyncTodayAssignment['visits'][number];
type ReadError = { code?: string; message: string };

type FieldSyncTodayRead = ActionResult<{ today: FieldSyncToday }, 'load_failed'>;

const FAILED: FieldSyncTodayRead = { success: false, error: 'load_failed' };

/** The day's window: from Berlin midnight to the next one. */
function berlinDay(now: Date): { date: string; from: string; to: string } {
  return {
    date: formatBerlinLocalDate(now),
    from: getLocalDayStart(now).toISOString(),
    to: new Date(getLocalDayEnd(now).getTime() + 1).toISOString(),
  };
}

/** A content hash of everything the device shows, so an unchanged day answers `304 Not Modified`. */
function snapshotVersion(content: Omit<FieldSyncToday, 'version'>): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('base64url');
}

function failed(label: string, error: ReadError): FieldSyncTodayRead {
  logReadFailure(`readFieldSyncToday: ${label} failed`, { code: error.code ?? 'unknown' });
  return FAILED;
}

/** The caller's scheduled job visits that overlap the day, grouped by job in start order. */
async function readDayVisits(
  admin: AdminClient,
  caller: Caller,
  employeeRecordId: string,
  day: { date: string; from: string; to: string },
): Promise<{ visits: Map<string, Visit[]>; error: ReadError | null }> {
  const occurrences = await readCompleteRows(
    (start, end) =>
      admin
        .from('planning_occurrences')
        .select(
          'id, job_id, time_kind, start_at, end_at, assignee:planning_occurrence_assignments!inner(employee_record_id)',
        )
        .eq('organization_id', caller.organizationId)
        .eq('entry_kind', 'job_visit')
        .eq('status', 'scheduled')
        .eq('assignee.employee_record_id', employeeRecordId)
        .or(
          `and(time_kind.eq.timed,start_at.lt.${day.to},end_at.gt.${day.from}),` +
            `and(time_kind.eq.all_day,start_date.lte.${day.date},end_date_exclusive.gt.${day.date})`,
        )
        .order('id')
        .range(start, end),
    LIST_ROW_CAP,
  );
  const visits = new Map<string, Visit[]>();
  for (const occurrence of occurrences.data) {
    if (!occurrence.job_id) continue;
    const timed = occurrence.time_kind === 'timed';
    const visit = {
      startAt: timed ? occurrence.start_at : null,
      endAt: timed ? occurrence.end_at : null,
    };
    visits.set(occurrence.job_id, [...(visits.get(occurrence.job_id) ?? []), visit]);
  }
  for (const list of visits.values()) list.sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''));
  return { visits, error: occurrences.error };
}

/** The jobs of the day the caller is assigned to, with their instruction items. */
async function readAssignedJobs(admin: AdminClient, caller: Caller, jobIds: string[]) {
  const [assignments, jobs, instructions] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      admin
        .from('job_assignments')
        .select('job_id')
        .eq('organization_id', caller.organizationId)
        .eq('user_id', caller.userId)
        .in('job_id', batch),
    ),
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select(
          'id, job_number, title, description, planned_working_minutes, location, client_id, project_id, site_id, contact_id',
        )
        .eq('organization_id', caller.organizationId)
        .in('id', batch),
    ),
    readInBatches(jobIds, (batch) =>
      readCompleteRows(
        (start, end) =>
          admin
            .from('job_instruction_items')
            .select('id, job_id, content, group_label, notes, requirement_state, is_completed, sort_order')
            .eq('organization_id', caller.organizationId)
            .in('job_id', batch)
            .order('id')
            .range(start, end),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const assigned = new Set(assignments.data.map((row) => row.job_id));
  return {
    jobs: jobs.data.filter((job) => assigned.has(job.id)),
    instructions: instructions.data,
    error: assignments.error ?? jobs.error ?? instructions.error,
  };
}

type AssignedJob = Awaited<ReturnType<typeof readAssignedJobs>>['jobs'][number];

function presentIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** The projects, customers, sites and contacts the jobs name; a project's customer wins over the job's. */
async function readJobContext(admin: AdminClient, caller: Caller, jobs: AssignedJob[]) {
  const projects = await readInBatches(presentIds(jobs.map((job) => job.project_id)), (batch) =>
    admin
      .from('projects')
      .select('id, name, project_number, client_id')
      .eq('organization_id', caller.organizationId)
      .in('id', batch),
  );
  const projectById = new Map(projects.data.map((project) => [project.id, project]));
  const clientIdOf = (job: AssignedJob): string | null =>
    job.project_id ? (projectById.get(job.project_id)?.client_id ?? null) : job.client_id;
  const [clients, sites, contacts] = await Promise.all([
    readInBatches(presentIds(jobs.map(clientIdOf)), (batch) =>
      admin
        .from('clients')
        .select('id, name, phone')
        .eq('organization_id', caller.organizationId)
        .in('id', batch),
    ),
    readInBatches(presentIds(jobs.map((job) => job.site_id)), (batch) =>
      admin
        .from('client_sites')
        .select('id, name, street, postal_code, city, access_notes')
        .eq('organization_id', caller.organizationId)
        .in('id', batch),
    ),
    readInBatches(presentIds(jobs.map((job) => job.contact_id)), (batch) =>
      admin
        .from('client_contacts')
        .select('id, name, role, phone')
        .eq('organization_id', caller.organizationId)
        .in('id', batch),
    ),
  ]);
  return {
    projectById,
    clientIdOf,
    clientById: new Map(clients.data.map((client) => [client.id, client])),
    siteById: new Map(sites.data.map((site) => [site.id, site])),
    contactById: new Map(contacts.data.map((contact) => [contact.id, contact])),
    error: projects.error ?? clients.error ?? sites.error ?? contacts.error,
  };
}

type JobContext = Awaited<ReturnType<typeof readJobContext>>;
type InstructionRow = Awaited<ReturnType<typeof readAssignedJobs>>['instructions'][number];

function toAssignment(
  job: AssignedJob,
  visits: Visit[],
  context: JobContext,
  instructions: InstructionRow[],
): FieldSyncTodayAssignment {
  const project = job.project_id ? context.projectById.get(job.project_id) : undefined;
  const clientId = context.clientIdOf(job);
  const client = clientId ? context.clientById.get(clientId) : undefined;
  const site = job.site_id ? context.siteById.get(job.site_id) : undefined;
  const contact = job.contact_id ? context.contactById.get(job.contact_id) : undefined;
  const siteAddress = site
    ? formatSiteAddress({ street: site.street, postalCode: site.postal_code, city: site.city })
    : '';
  return {
    jobId: job.id,
    jobNumber: job.job_number,
    title: job.title,
    requestedOutcome: job.description,
    plannedWorkingMinutes: job.planned_working_minutes,
    visits,
    customerName: client?.name ?? null,
    customerPhone: client?.phone ?? null,
    siteName: site?.name ?? null,
    siteAddress: siteAddress || job.location || null,
    accessNotes: site?.access_notes ?? null,
    contactName: contact?.name ?? null,
    contactRole: contact?.role ?? null,
    contactPhone: contact?.phone ?? null,
    project: project?.project_number ? { name: project.name, projectNumber: project.project_number } : null,
    instructions: instructions
      .filter((item) => item.job_id === job.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        id: item.id,
        content: item.content,
        groupLabel: item.group_label,
        notes: item.notes,
        required: item.requirement_state === 'required',
        done: item.is_completed,
      })),
  };
}

function snapshotOf(
  caller: Caller,
  day: { date: string; to: string },
  assignments: FieldSyncTodayAssignment[],
): FieldSyncToday {
  const content = {
    berlinDate: day.date,
    validUntil: day.to,
    userId: caller.userId,
    organizationId: caller.organizationId,
    assignments,
  };
  return { version: snapshotVersion(content), ...content };
}

/**
 * The caller's today snapshot. The caller must come from
 * `resolveActiveContextForUser`: user and organization are never taken from
 * the request. A failed read is a failure, never a shorter day.
 */
export async function readFieldSyncToday(
  caller: Caller,
  now: Date = new Date(),
): Promise<FieldSyncTodayRead> {
  const admin = createSupabaseAdminClient();
  const day = berlinDay(now);
  const record = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', caller.organizationId)
    .eq('user_id', caller.userId)
    .limit(1);
  if (record.error) return failed('employee record', record.error);
  const employeeRecordId = record.data[0]?.id;
  if (!employeeRecordId) return { success: true, today: snapshotOf(caller, day, []) };

  const dayVisits = await readDayVisits(admin, caller, employeeRecordId, day);
  if (dayVisits.error) return failed('visits', dayVisits.error);
  const assigned = await readAssignedJobs(admin, caller, [...dayVisits.visits.keys()]);
  if (assigned.error) return failed('jobs', assigned.error);
  const context = await readJobContext(admin, caller, assigned.jobs);
  if (context.error) return failed('job context', context.error);

  const assignments = assigned.jobs
    .map((job) => toAssignment(job, dayVisits.visits.get(job.id) ?? [], context, assigned.instructions))
    .sort(
      (a, b) =>
        (a.visits[0]?.startAt ?? '').localeCompare(b.visits[0]?.startAt ?? '') ||
        a.title.localeCompare(b.title, 'de'),
    );
  return { success: true, today: snapshotOf(caller, day, assignments) };
}
