import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The shapes of Bereitschaft (werk-flow/werkflow-planning#469): the action
// inputs as the network delivers them, and the read the server hands the
// pages. `read_on_call_shifts` builds the read in SQL; the schemas below parse
// it at the boundary.

const instantSchema = z.iso.datetime({ offset: true });
const labelSchema = z.string().trim().max(60);
const noteSchema = z.string().trim().max(2000);
const memberIdsSchema = z.array(uuidSchema).min(1).max(20);

const shiftStateSchema = z.object({
  organizationId: uuidSchema,
  shiftId: uuidSchema,
  startsAt: instantSchema,
  endsAt: instantSchema,
  label: labelSchema,
  handoverNote: noteSchema,
  memberIds: memberIdsSchema,
  /** The planner saw the warning that another shift with the label covers the same time. */
  confirmOverlap: z.boolean(),
});

/** A new shift under the id the browser chose, so a repeated call finds it. */
export const planShiftInputSchema = shiftStateSchema;
export type PlanShiftInput = z.input<typeof planShiftInputSchema>;

export const changeShiftInputSchema = shiftStateSchema.extend({ expectedVersion: z.number().int().min(1) });
export type ChangeShiftInput = z.input<typeof changeShiftInputSchema>;

export const endShiftInputSchema = z.object({
  organizationId: uuidSchema,
  shiftId: uuidSchema,
  expectedVersion: z.number().int().min(1),
});
export type EndShiftInput = z.input<typeof endShiftInputSchema>;

export const handOverInputSchema = z.object({
  organizationId: uuidSchema,
  shiftId: uuidSchema,
  expectedVersion: z.number().int().min(1),
  nextShiftId: uuidSchema,
  nextEndsAt: instantSchema,
  nextLabel: labelSchema,
  handoverNote: noteSchema,
  memberIds: memberIdsSchema,
  confirmOverlap: z.boolean(),
});
export type HandOverInput = z.input<typeof handOverInputSchema>;

const memberSchema = z.object({
  employeeRecordId: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
});
export type OnCallMember = z.infer<typeof memberSchema>;

const historyKindSchema = z.enum(['planned', 'changed', 'ended', 'cancelled', 'handed_over', 'taken_over']);
export type OnCallHistoryKind = z.infer<typeof historyKindSchema>;

const historyEntrySchema = z.object({
  // A kind a newer release writes reads as a change.
  kind: z.string().transform((kind) => historyKindSchema.catch('changed').parse(kind)),
  version: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
  label: z.string().nullable(),
  handoverNote: z.string(),
  cancelledAt: z.string().nullable(),
  memberIds: z.array(z.string()),
  actorName: z.string(),
  createdAt: z.string(),
});

const shiftSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  label: z.string().nullable(),
  handoverNote: z.string(),
  cancelledAt: z.string().nullable(),
  version: z.number(),
  members: z.array(memberSchema),
  history: z.array(historyEntrySchema),
});
export type OnCallShift = z.infer<typeof shiftSchema>;

const personSchema = memberSchema.extend({ active: z.boolean() });
export type OnCallPerson = z.infer<typeof personSchema>;

export const onCallReadSchema = z.object({
  shifts: z.array(shiftSchema),
  people: z.array(personSchema),
});
export type OnCallRead = z.infer<typeof onCallReadSchema>;

/** What the dashboard shows every member: the shifts of the next days and the caller's own record. */
export type OnCallOverview = {
  shifts: OnCallShift[];
  ownEmployeeRecordId: string | null;
};

/** What the office's week list shows. */
export type OnCallWeekView = {
  /** The Monday of the shown week (`YYYY-MM-DD`). */
  monday: string;
  shifts: OnCallShift[];
  /** The shifts running now, which a handover ends. */
  running: OnCallShift[];
  people: OnCallPerson[];
};
