'use client';

import { useLiveAttentionOverview } from '@/components/aufgaben/use-aufgaben-overview';
import { OfficeStartSkeleton } from '@/components/loading-states/office-start-skeleton';
import { useOrganization } from '@/components/organization/organization-context';
import { StaleRegion } from '@/components/shared/stale-region';
import { UsableContent } from '@/components/shared/usable-content';
import { SectionError } from '@/components/ui/section-error';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import { OfficeStartSections } from './office-start-sections';

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
 * maintenance. It reads in the browser, because every clock action renders
 * the dashboard's server component again.
 */
export function OfficeStart() {
  const attention = useLiveAttentionOverview();
  const maintenance = useOverdueMaintenanceCount();

  // The maintenance count loads and fails on its own, below the sections.
  if (attention.isLoading) return <OfficeStartSkeleton />;
  if (!attention.data) {
    return (
      <div className="mx-auto max-w-3xl">
        <SectionError onRetry={() => void attention.refresh()} retryPending={attention.isRefreshing}>
          Deine offenen Aufgaben konnten nicht geladen werden. Bitte versuche es erneut.
        </SectionError>
      </div>
    );
  }

  return (
    <UsableContent name="office-start" count={attention.data.tasks.length}>
      <section
        className="mx-auto max-w-3xl space-y-6"
        aria-labelledby="office-start-heading"
        data-testid="office-start"
      >
        <h2 id="office-start-heading" className="text-sm font-semibold">
          Was jetzt ansteht
        </h2>
        <StaleRegion stale={attention.isStale} onRetry={attention.refresh} className="space-y-6">
          <OfficeStartSections tasks={attention.data.tasks} overdueMaintenance={maintenance.data ?? null} />
        </StaleRegion>
        {!maintenance.isLoading && maintenance.data === undefined && (
          <SectionError onRetry={() => void maintenance.refresh()} retryPending={maintenance.isRefreshing}>
            Die überfällige Wartung konnte nicht geladen werden. Bitte versuche es erneut.
          </SectionError>
        )}
      </section>
    </UsableContent>
  );
}
