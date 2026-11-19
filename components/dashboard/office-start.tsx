'use client';

import { useLiveAttentionOverview } from '@/components/aufgaben/use-aufgaben-overview';
import { useOrganization } from '@/components/organization/organization-context';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import { OfficeStartView } from './office-start-sections';
import { OwnerStartView } from './owner-start';

/**
 * The count of überfällig maintenance from the Wartung list's own reader,
 * live on the tables that list follows. Its first page of each list is read
 * and left unused: the count has no reader of its own.
 */
function useOverdueMaintenanceCount() {
  const { activeOrgId } = useOrganization();
  const view = useLiveView<number>({
    tables: ['maintenance_coverages', 'maintenance_plans', 'maintenance_due_work'],
    resetKey: activeOrgId,
    read: async ({ signal }): Promise<LiveViewResult<number>> => {
      if (!activeOrgId) return { ok: false };
      const result = await readInBackground(
        'maintenance-workspace',
        {
          search: '',
          overdueOnly: true,
          duePage: 1,
          planPage: 1,
          coveragePage: 1,
          organizationId: activeOrgId,
        },
        signal,
      );
      return result.success ? { ok: true, data: result.workspace.totals.due.overdue } : { ok: false };
    },
  });
  // A due date that passes makes its work überfällig without a write.
  useBusinessDayRefresh(view.refresh);
  return view;
}

/**
 * What needs Büro and Admin now: the Aufgaben sections without personnel
 * approvals, each with its count and first items, and the überfällig
 * maintenance. Admin first sees what needs the owner's decision, from the
 * same two reads. It reads in the browser, because every clock action renders
 * the dashboard's server component again.
 */
export function OfficeStart() {
  const { activeOrg } = useOrganization();
  const attention = useLiveAttentionOverview();
  const maintenance = useOverdueMaintenanceCount();
  return (
    <div className="space-y-10">
      {activeOrg?.role === 'admin' && <OwnerStartView attention={attention} maintenance={maintenance} />}
      <OfficeStartView attention={attention} maintenance={maintenance} />
    </div>
  );
}
