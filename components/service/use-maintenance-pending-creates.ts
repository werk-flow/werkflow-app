'use client';

import { useEffect, useState } from 'react';

import type { useBanner } from '@/components/ui/banner';
import type { MaintenanceWorkspace } from '@/lib/maintenance/types';
import type {
  MaintenanceCoverageCreateSubmission,
  MaintenanceCoveragePendingDraft,
} from './maintenance-coverage-dialog';
import type { MaintenancePlanCreateSubmission, MaintenancePlanPendingDraft } from './maintenance-plan-dialog';

type MaintenanceCreateSubmission = MaintenancePlanCreateSubmission | MaintenanceCoverageCreateSubmission;
type MaintenancePendingDraft = MaintenancePlanPendingDraft | MaintenanceCoveragePendingDraft;

// The page mounts the create buttons in their own Suspense tree beside the
// heading, so a submission reaches the workspace through this module channel
// instead of props. The workspace is the one listener: it renders the pending
// card or row, settles through its live read, and shows the failure banner.
const submissionListeners = new Set<(submission: MaintenanceCreateSubmission) => void>();
export function announceSubmission(submission: MaintenanceCreateSubmission): void {
  for (const listener of submissionListeners) listener(submission);
}

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
    submissionListeners.add(listener);
    return () => {
      submissionListeners.delete(listener);
    };
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
