import type {
  CapacityDayContext,
  CapacityEvaluation,
  PlanningConflict,
} from './types';

export type ProposedEmployeeMinutes = {
  employeeRecordId: string;
  localDate: string;
  minutes: number;
};

export const CAPACITY_CONFLICT_MESSAGES = {
  no_schedule: 'Für diesen Tag ist keine Arbeitszeit hinterlegt.',
  holiday_or_closure: 'Der Termin liegt auf einem arbeitsfreien Tag.',
  approved_absence: 'Für diesen Zeitraum liegt eine genehmigte Abwesenheit vor.',
  pending_absence: 'Für diesen Tag liegt ein noch offener Abwesenheitsantrag vor.',
  overlap: 'Der Termin überschneidet sich mit bereits geplanter Arbeit.',
  over_capacity: 'Die geplante Zeit überschreitet die verfügbare Tageskapazität.',
} as const;

export function evaluateCapacity(
  proposed: ProposedEmployeeMinutes[],
  contexts: CapacityDayContext[]
): CapacityEvaluation {
  const contextByKey = new Map(
    contexts.map((context) => [
      `${context.employeeRecordId}:${context.localDate}`,
      context,
    ])
  );
  const conflicts: PlanningConflict[] = [];
  const employeeDays: CapacityEvaluation['employeeDays'] = [];
  const proposedByEmployeeDay = new Map<string, ProposedEmployeeMinutes>();

  for (const allocation of proposed) {
    const key = `${allocation.employeeRecordId}:${allocation.localDate}`;
    const existing = proposedByEmployeeDay.get(key);
    proposedByEmployeeDay.set(key, {
      ...allocation,
      minutes: allocation.minutes + (existing?.minutes ?? 0),
    });
  }

  for (const allocation of proposedByEmployeeDay.values()) {
    const key = `${allocation.employeeRecordId}:${allocation.localDate}`;
    const context = contextByKey.get(key) ?? {
      employeeRecordId: allocation.employeeRecordId,
      localDate: allocation.localDate,
      targetMinutes: null,
      targetSource: 'missing',
      approvedAbsenceMinutes: 0,
      pendingAbsenceMinutes: 0,
      existingPlannedMinutes: 0,
      overlapMinutes: 0,
    };
    const remainingMinutes =
      context.targetMinutes === null
        ? null
        : Math.max(
            0,
            context.targetMinutes -
              context.approvedAbsenceMinutes -
              context.existingPlannedMinutes
          );
    employeeDays.push({ ...context, proposedMinutes: allocation.minutes, remainingMinutes });

    const common = {
      severity: 'warning' as const,
      employeeRecordId: allocation.employeeRecordId,
      localDate: allocation.localDate,
    };
    if (context.targetMinutes === null) {
      conflicts.push({
        ...common,
        kind: 'no_schedule',
        message: CAPACITY_CONFLICT_MESSAGES.no_schedule,
        details: { targetSource: context.targetSource },
      });
    } else if (context.targetMinutes === 0) {
      conflicts.push({
        ...common,
        kind: 'holiday_or_closure',
        message: CAPACITY_CONFLICT_MESSAGES.holiday_or_closure,
        details: { targetSource: context.targetSource },
      });
    }
    if (context.approvedAbsenceMinutes > 0) {
      conflicts.push({
        ...common,
        kind: 'approved_absence',
        message: CAPACITY_CONFLICT_MESSAGES.approved_absence,
        details: { absenceMinutes: context.approvedAbsenceMinutes },
      });
    }
    if (context.pendingAbsenceMinutes > 0) {
      conflicts.push({
        ...common,
        kind: 'pending_absence',
        message: CAPACITY_CONFLICT_MESSAGES.pending_absence,
        details: { provisional: true, absenceMinutes: context.pendingAbsenceMinutes },
      });
    }
    if (context.overlapMinutes > 0) {
      conflicts.push({
        ...common,
        kind: 'overlap',
        message: CAPACITY_CONFLICT_MESSAGES.overlap,
        details: { overlapMinutes: context.overlapMinutes },
      });
    }
    if (remainingMinutes !== null && allocation.minutes > remainingMinutes) {
      conflicts.push({
        ...common,
        kind: 'over_capacity',
        message: CAPACITY_CONFLICT_MESSAGES.over_capacity,
        details: {
          proposedMinutes: allocation.minutes,
          remainingMinutes,
          targetMinutes: context.targetMinutes,
        },
      });
    }
  }

  return { conflicts, employeeDays };
}

export function calculateIntervalOverlapMinutes(
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date
): number {
  const overlapStart = Math.max(firstStart.getTime(), secondStart.getTime());
  const overlapEnd = Math.min(firstEnd.getTime(), secondEnd.getTime());
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 60_000));
}

export async function fingerprintSnapshot(value: unknown): Promise<string> {
  const serialized = JSON.stringify(sortObject(value));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialized)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function compareByCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortObject(value: unknown): unknown {
  if (value === undefined) return '\u0000werkflow:undefined';
  if (Array.isArray(value)) return value.map(sortObject);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return [...value.entries()]
      .sort(([left], [right]) => compareByCodePoint(String(left), String(right)))
      .map(([key, nested]) => [key, sortObject(nested)]);
  }
  if (value instanceof Set) {
    return [...value].map(sortObject).sort((left, right) =>
      compareByCodePoint(JSON.stringify(left), JSON.stringify(right))
    );
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareByCodePoint(left, right))
        .map(([key, nested]) => [key, sortObject(nested)])
    );
  }
  return value;
}
