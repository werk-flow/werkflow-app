import 'server-only';

import { z } from 'zod';

import { getJobDispatchCards } from '@/lib/dispatch/actions';
import { getJobMaterialLines } from '@/lib/inventory/actions';
import { getProfilesByIds } from '@/lib/members/actions';
import { getWeeklyTargets } from '@/lib/personnel/target-actions';
import { getOwnSicknessReports } from '@/lib/sickness/actions';
import { getJobQualificationDetail } from '@/lib/qualifications/actions';
import { getProvisionalTimeSummary, getTimeCorrectionRequests } from '@/lib/time-corrections/actions';
import {
  getPendingChangeRequests,
  getPendingSessions,
  getTimeEntries,
  getTimeEntriesForJob,
} from '@/lib/time-tracking/actions';
import {
  getDecidableApprovedVacationRequests,
  getOwnVacationOverview,
  getPendingVacationRequestsForApprover,
} from '@/lib/vacation/actions';
import { uuidSchema } from '@/lib/validation/uuid';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import { getWorkLifecycleSnapshot } from '@/lib/work-lifecycle/actions';

/**
 * The closed set of read-only readers a page may run in the background over
 * `GET /api/background-read` instead of the browser's serialized Server Action
 * queue (pre-Wave-3 step 3, decision D3). Every reader keeps its own identity,
 * membership and subject checks; the route adds cookie identity and the
 * active-organization equality for inputs that name one. Add a kind here, in
 * the client's import inventory test, and nowhere else.
 */
const isoTimestamp = z.string().datetime({ offset: true });
const organizationInput = z.object({ organizationId: uuidSchema });
const jobInput = z.object({ jobId: uuidSchema });
const targetInput = z.object({ targetType: z.enum(['job', 'project']), targetId: uuidSchema });
const noInput = z.object({});

function defineRead<Input, Result>(input: z.ZodType<Input>, read: (input: Input) => Promise<Result>): {
  input: z.ZodType<Input>;
  read: (input: Input) => Promise<Result>;
} {
  return { input, read };
}

export const BACKGROUND_READS = {
  'time-entries': defineRead(
    z.object({
      organizationId: uuidSchema,
      from: isoTimestamp,
      to: isoTimestamp,
      userId: uuidSchema.optional(),
      status: z.enum(['pending', 'approved', 'rejected', 'pending_delete']).optional(),
    }),
    (input) =>
      getTimeEntries({
        organizationId: input.organizationId,
        from: input.from,
        to: input.to,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
  ),
  'weekly-targets': defineRead(z.object({ userId: uuidSchema }), (input) => getWeeklyTargets(input)),
  'own-vacation-overview': defineRead(noInput, () => getOwnVacationOverview()),
  'own-sickness-reports': defineRead(noInput, () => getOwnSicknessReports()),
  'provisional-time-summary': defineRead(
    z.object({ organizationId: uuidSchema, userId: uuidSchema }),
    (input) => getProvisionalTimeSummary(input)
  ),
  'profiles-by-ids': defineRead(
    z.object({ userIds: z.array(uuidSchema).max(1_000) }),
    async (input) => ({ success: true as const, profiles: await getProfilesByIds(input.userIds) })
  ),
  'pending-sessions': defineRead(organizationInput, (input) => getPendingSessions(input.organizationId)),
  'pending-change-requests': defineRead(organizationInput, (input) => getPendingChangeRequests(input.organizationId)),
  'time-correction-requests': defineRead(organizationInput, (input) => getTimeCorrectionRequests(input.organizationId)),
  'pending-vacation-for-approver': defineRead(noInput, () => getPendingVacationRequestsForApprover()),
  'decidable-approved-vacation': defineRead(noInput, () => getDecidableApprovedVacationRequests()),
  'time-entries-for-job': defineRead(jobInput, (input) => getTimeEntriesForJob(input.jobId)),
  'job-dispatch-cards': defineRead(jobInput, (input) => getJobDispatchCards(input.jobId)),
  'job-qualification-detail': defineRead(jobInput, (input) => getJobQualificationDetail(input.jobId)),
  'job-material-lines': defineRead(jobInput, (input) => getJobMaterialLines(input.jobId)),
  'work-artifacts': defineRead(targetInput, (input) => getWorkArtifacts(input)),
  'work-lifecycle-snapshot': defineRead(targetInput, (input) => getWorkLifecycleSnapshot(input)),
} as const;

export type BackgroundReadKind = keyof typeof BACKGROUND_READS;
export type BackgroundReadInput<Kind extends BackgroundReadKind> = z.infer<(typeof BACKGROUND_READS)[Kind]['input']>;
export type BackgroundReadResult<Kind extends BackgroundReadKind> = Awaited<
  ReturnType<(typeof BACKGROUND_READS)[Kind]['read']>
>;

export function isBackgroundReadKind(value: string): value is BackgroundReadKind {
  return Object.hasOwn(BACKGROUND_READS, value);
}
