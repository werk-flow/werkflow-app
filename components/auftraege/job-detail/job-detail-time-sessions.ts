import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import type { TimeEntry, WorkSession } from '@/lib/time-tracking/types';
import type { JobAssignmentWithProfile } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { getSessionPersonName, type SessionPerson } from './job-detail-person';

export type JobTimeParticipant = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatarPath: string | null;
};

/** A work session of this job; sessions without a clock-in are filtered out. */
export type JobWorkSession = WorkSession & { clockIn: TimeEntry };

export type JobEmployeeMinutes = {
  userId: string;
  name: string;
  minutes: number;
  isLive: boolean;
  person: SessionPerson | null;
};

export function collectJobSessionPeople(
  members: OrgMemberOption[],
  assignments: JobAssignmentWithProfile[],
  timeParticipants: JobTimeParticipant[],
): Map<string, SessionPerson> {
  const people = new Map<string, SessionPerson>();

  for (const member of members) {
    people.set(member.userId, {
      firstName: member.firstName || null,
      lastName: member.lastName || null,
    });
  }

  for (const assignment of assignments) {
    if (!people.has(assignment.userId)) {
      people.set(assignment.userId, {
        firstName: assignment.firstName,
        lastName: assignment.lastName,
        email: assignment.email,
        avatarPath: assignment.avatarPath,
      });
    }
  }

  for (const participant of timeParticipants) {
    if (!people.has(participant.userId)) {
      people.set(participant.userId, {
        firstName: participant.firstName,
        lastName: participant.lastName,
        email: participant.email,
        avatarPath: participant.avatarPath,
      });
    }
  }

  return people;
}

export function collectJobWorkSessions(timeEntries: TimeEntry[], jobId: string): JobWorkSession[] {
  const entriesByUser: Record<string, TimeEntry[]> = {};
  for (const e of timeEntries) {
    const userEntries = entriesByUser[e.userId];
    if (userEntries) userEntries.push(e);
    else entriesByUser[e.userId] = [e];
  }
  return Object.values(entriesByUser)
    .flatMap((ue) => calculateWorkSessions(ue))
    .filter((session): session is JobWorkSession => session.clockIn !== null && session.jobId === jobId)
    .sort((a, b) => new Date(b.clockIn.timestamp).getTime() - new Date(a.clockIn.timestamp).getTime());
}

export function sumJobMinutesPerEmployee(
  allSessions: JobWorkSession[],
  sessionPeople: Map<string, SessionPerson>,
  getSessionDurationMinutes: (session: JobWorkSession) => number,
): JobEmployeeMinutes[] {
  const map: Record<string, JobEmployeeMinutes> = {};
  for (const s of allSessions) {
    if (!s.clockIn) continue;
    const uid = s.clockIn.userId;
    if (!map[uid]) {
      const person = sessionPeople.get(uid);
      map[uid] = {
        userId: uid,
        name: getSessionPersonName(person),
        minutes: 0,
        isLive: false,
        person: person ?? null,
      };
    }
    map[uid].minutes += getSessionDurationMinutes(s);
    if (!s.clockOut && !s.isOrphan) {
      map[uid].isLive = true;
    }
  }
  return Object.values(map).sort((a, b) => b.minutes - a.minutes);
}
