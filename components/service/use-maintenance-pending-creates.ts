'use client';

import { useEffect, useState } from 'react';

import type { useBanner } from '@/components/ui/banner';
import type { MaintenanceWorkspace } from '@/lib/maintenance/types';
import type {
  MaintenanceCoverageCreateSubmission,
  MaintenanceCoveragePendingDraft,
} from './maintenance-coverage-dialog';
import type { MaintenancePlanCreateSubmission, MaintenancePlanPendingDraft } from './maintenance-plan-dialog';
import { createSubmissionChannel } from './submission-channel';

type MaintenanceCreateSubmission = MaintenancePlanCreateSubmission | MaintenanceCoverageCreateSubmission;
type MaintenancePendingDraft = MaintenancePlanPendingDraft | MaintenanceCoveragePendingDraft;

// The create buttons sit beside the heading; the workspace is the one listener.
export const maintenanceSubmissions = createSubmissionChannel<MaintenanceCreateSubmission>();

/** The workspace's optimistic create placeholders, fed by the toolbar's submission channel. */
export function useMaintenancePendingCreates({
  workspace,
  liveRefresh,
  liveInvalidate,
  showBanner,
}: {
  workspace: MaintenanceWorkspace;
  liveRefresh: () => Promise<void>;
  liveInvalidate: () => void;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
}): { pendingPlans: MaintenancePlanPendingDraft[]; pendingCoverages: MaintenanceCoveragePendingDraft[] } {
  const [pendingCreates, setPendingCreates] = useState<MaintenancePendingDraft[]>([]);
  useEffect(() => {
    const listener = ({ draft, result }: MaintenanceCreateSubmission) => {
      liveInvalidate();
      setPendingCreates((current) => [...current, draft]);
      void result
        .then(async (outcome) => {
          if (outcome.success) await liveRefresh();
          else showBanner({ variant: 'error', message: outcome.message });
        })
        .finally(() => setPendingCreates((current) => current.filter((item) => item.id !== draft.id)));
    };
    return maintenanceSubmissions.subscribe(listener);
  }, [liveInvalidate, liveRefresh, showBanner]);
  // Both lists are newest first, so a new record leads; a Realtime read that
  // arrives before the settle read drops the placeholder by id.
  const pendingPlans = pendingCreates.filter(
    (draft): draft is MaintenancePlanPendingDraft =>
      draft.kind === 'plan' && !workspace.plans.some((plan) => plan.id === draft.id),
  );
  const pendingCoverages = pendingCreates.filter(
    (draft): draft is MaintenanceCoveragePendingDraft =>
      draft.kind === 'coverage' && !workspace.coverages.some((coverage) => coverage.id === draft.id),
  );
  return { pendingPlans, pendingCoverages };
}
