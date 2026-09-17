import { z } from 'zod';
import { timeActivitySelectionSchema } from './activity-selection-schema';
import type { LiveClockState } from './types';
import type { getCurrentClockState as readClock, getActiveJobIdsForOrg as readActiveJobs } from './actions';

const text = z.string();
const nullableText = text.nullable();
const clockJobInfoSchema = z.object({ id: text, title: text, jobNumber: nullableText, status: text, projectName: nullableText, clientName: nullableText });
const clockStateSchema = z.object({
  organizationId: text, breakMode: z.enum(['manual', 'automatic']),
  autoBreakThresholdMinutes: z.number(), autoBreakDurationMinutes: z.number(),
  status: z.enum(['clocked_out', 'working', 'on_break']), isClockedIn: z.boolean(), isOnBreak: z.boolean(),
  clockInTime: nullableText, statusStartedAt: nullableText, breakStartTime: nullableText,
  todayMinutes: z.number(), workMinutes: z.number(), breakMinutes: z.number(),
  timelineSegments: z.array(z.object({ type: z.enum(['work', 'break']), minutes: z.number() })),
  activeJobId: nullableText,
  activeJobInfo: clockJobInfoSchema.nullable(),
  captureModel: z.enum(['canonical', 'legacy', 'none']), sessionId: nullableText, sessionVersion: z.number().nullable(),
  currentSegmentId: nullableText, currentActivity: timeActivitySelectionSchema.nullable(),
  resumeActivity: timeActivitySelectionSchema.nullable(), resumeJobInfo: clockJobInfoSchema.nullable(), recoveryReason: nullableText,
  legacyOpen: z.boolean(), standbyMinutes: z.number(), travelMinutes: z.number(), calloutMinutes: z.number(), internalMinutes: z.number(), fetchedAt: text,
}) satisfies z.ZodType<LiveClockState>;
const failure = z.object({ success: z.literal(false), error: text });
const clockResponse = z.discriminatedUnion('success', [failure, z.object({ success: z.literal(true), state: clockStateSchema })]);
const activeJobsResponse = z.discriminatedUnion('success', [failure, z.object({ success: z.literal(true), activeJobIds: z.array(text), activeProjectIds: z.array(text) })]);

async function readState<Result extends { success: boolean }>(organizationId: string, kind: 'clock' | 'active-jobs', schema: z.ZodType<Result>, signal?: AbortSignal): Promise<Result | { success: false; error: string }> {
  try {
    const response = await fetch(`/api/time-tracking-state?${new URLSearchParams({ organizationId, kind })}`, { cache: 'no-store', credentials: 'same-origin', signal: signal ?? null });
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success || (!response.ok && parsed.data.success)) return { success: false, error: 'time_state_read_failed' };
    return parsed.data;
  } catch {
    return { success: false, error: 'time_state_read_failed' };
  }
}

export async function getCurrentClockState(organizationId: string, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof readClock>>> {
  const result = await readState(organizationId, 'clock', clockResponse, signal);
  if (result.success && result.state.organizationId !== organizationId) return { success: false, error: 'organization_changed' };
  return result;
}

export async function getActiveJobIdsForOrg(organizationId: string, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof readActiveJobs>>> {
  return readState(organizationId, 'active-jobs', activeJobsResponse, signal);
}
