'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBusyIds } from '@/hooks/use-busy-id';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import type { CustomerRelationshipBundle } from '@/lib/customer-relationships/types';
import type { ClientContact } from '@/lib/clients/types';
import { CommunicationPreferencesSection } from './communication-preferences-section';
import { CustomerFollowUpDialog } from './customer-follow-up-dialog';
import { CustomerTimelineSection } from './customer-timeline-section';
import { FollowUpsSection } from './follow-ups-section';
import { useCustomerTimeline } from './use-customer-timeline';
import { useFollowUpEditor } from './use-follow-up-editor';

// Busy id for the communication settings, which have no row of their own, so
// the section header can show them settling.
const COMMUNICATION_ID = 'communication';

export function CustomerRelationshipWorkspace({
  clientId,
  currentUserId,
  contacts,
  initialBundle,
}: {
  clientId: string;
  currentUserId: string;
  contacts: ClientContact[];
  initialBundle: CustomerRelationshipBundle;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusedFollowUpId = searchParams.get('followUp');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferenceOpen, setPreferenceOpen] = useState(false);
  const { run: runRelationshipTask, isPending } = usePendingTask();
  // Row actions (erledigen, abbrechen) and the settle window after a dialog
  // save mark only the affected follow-up; the other rows stay usable.
  const { run: runRowTask, isBusy } = useBusyIds();
  const waitForBundle = useSettleOnChange(initialBundle);
  const timeline = useCustomerTimeline({
    clientId,
    initialBundle,
    runTask: runRelationshipTask,
  });
  const { bundle } = timeline;
  const followUps = useFollowUpEditor({
    clientId,
    currentUserId,
    bundle,
    runTask: runRelationshipTask,
    runRowTask,
    waitForBundle,
  });

  return (
    <div className="space-y-8" data-testid="customer-relationship-workspace">
      <FollowUpsSection
        openFollowUps={followUps.openFollowUps}
        historicFollowUps={followUps.historicFollowUps}
        focusedFollowUpId={focusedFollowUpId}
        isBusy={isBusy}
        onCreateFollowUp={() => followUps.openNewFollowUp()}
        onEditFollowUp={followUps.openExistingFollowUp}
        onTransitionFollowUp={followUps.transitionFollowUp}
      />

      <CommunicationPreferencesSection
        clientId={clientId}
        contacts={contacts}
        bundle={bundle}
        settingsOpen={settingsOpen}
        preferenceOpen={preferenceOpen}
        isPending={isPending}
        isSettling={isBusy(COMMUNICATION_ID)}
        onSettingsOpenChange={setSettingsOpen}
        onPreferenceOpenChange={setPreferenceOpen}
        onSaved={() => {
          router.refresh();
          void runRowTask(COMMUNICATION_ID, waitForBundle);
        }}
        runTask={runRelationshipTask}
      />

      <CustomerTimelineSection
        visibleTimeline={timeline.visibleTimeline}
        timelineFilter={timeline.timelineFilter}
        olderTimelineCursor={timeline.olderTimelineCursor}
        isPending={isPending}
        onTimelineFilterChange={timeline.setTimelineFilter}
        onLoadOlder={timeline.loadOlderTimeline}
        onFollowUp={followUps.openNewFollowUp}
      />

      <CustomerFollowUpDialog
        followUpDraft={followUps.followUpDraft}
        followUpOwners={bundle.followUpOwners}
        followUpError={followUps.followUpError}
        followUpTitleError={followUps.followUpTitleError}
        followUpOwnerError={followUps.followUpOwnerError}
        followUpDueError={followUps.followUpDueError}
        isPending={isPending}
        onDraftChange={followUps.setFollowUpDraft}
        onSave={followUps.saveFollowUp}
        onClose={followUps.closeFollowUpDialog}
      />
    </div>
  );
}
