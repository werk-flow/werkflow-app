import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import {
  getTimeEntries,
  getChangeRequestsForEntries
} from '@/lib/time-tracking/actions';
import { getJobsForCalendar } from '@/lib/jobs/actions';
import { CalendarContainer } from '@/components/kalender/calendar-container';
import type { OrgRole } from '@/lib/members/actions';
import type { EntryChangeRequestMap } from '@/lib/time-tracking/types';
import { toLocalDateString } from '@/lib/utils';

export default async function KalenderPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies()
  ]);

  if (!user) {
    redirect('/login');
  }

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

  if (!activeOrgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Kalender</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    );
  }

  const memberships = await getCachedMemberships(user.id);
  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  if (!currentMembership) {
    redirect('/dashboard');
  }

  const currentUserRole = currentMembership.role as OrgRole;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'manager';

  // Pre-fetch initial day-view data and members in parallel
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setDate(dayStart.getDate() - 1);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  type MemberRow = {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    role: string;
  };

  async function fetchMembers(): Promise<MemberRow[]> {
    if (!isAdminOrManager) return [];
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.rpc('get_org_members', { p_org_id: activeOrgId });
    if (!data) return [];
    if (currentUserRole === 'manager') {
      const MANAGED_ROLES = ['accountant', 'secretary', 'employee'];
      return data.filter(
        (m: { role: string; user_id: string }) =>
            MANAGED_ROLES.includes(m.role) || m.user_id === user!.id
      );
    }
    return data;
  }

  const fromIso = toLocalDateString(dayStart);
  const toIso = toLocalDateString(dayEnd);

  const [entriesResult, members, jobsResult] = await Promise.all([
    getTimeEntries({
      organizationId: activeOrgId,
      from: dayStart.toISOString(),
      to: dayEnd.toISOString()
    }),
    fetchMembers(),
    getJobsForCalendar(fromIso, toIso)
  ]);

  // Build initial change request map if we have entries
  let initialChangeRequestMap: EntryChangeRequestMap = {};
  if (entriesResult.success && entriesResult.entries && entriesResult.entries.length > 0) {
    const entryIds = entriesResult.entries.map((e) => e.id);
    const crResult = await getChangeRequestsForEntries(entryIds);
    if (crResult.success && crResult.requests) {
      for (const cr of crResult.requests) {
        initialChangeRequestMap[cr.entryId] = cr;
        if (cr.pairedEntryId) {
          initialChangeRequestMap[cr.pairedEntryId] = cr;
        }
      }
    }
  }

  return (
    <CalendarContainer
      organizationId={activeOrgId}
      currentUserId={user.id}
      currentUserRole={currentUserRole}
      isAdminOrManager={isAdminOrManager}
      members={members}
      initialEntries={entriesResult.success ? entriesResult.entries : undefined}
      initialChangeRequestMap={initialChangeRequestMap}
      initialJobs={jobsResult.success ? jobsResult.jobs : undefined}
    />
  );
}
