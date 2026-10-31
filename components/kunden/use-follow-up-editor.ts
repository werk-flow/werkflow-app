'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import {
  createCustomerFollowUp,
  transitionCustomerFollowUp,
  updateCustomerFollowUp,
} from '@/lib/customer-relationships/actions';
import {
  formatBerlinDateTimeInput,
  parseBerlinDateTimeInput,
  tomorrowMorningInBerlin,
} from '@/lib/date-time/berlin';
import type {
  ClientFollowUp,
  CustomerRelationshipBundle,
  FollowUpInput,
  FollowUpSourceType,
} from '@/lib/customer-relationships/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

// Busy id for a created follow-up, which has no row of its own yet, so the
// section header can show it settling.
export const FOLLOW_UP_LIST_ID = 'follow-ups';

export type FollowUpDraft = {
  id: string | null;
  title: string;
  note: string;
  ownerUserId: string;
  dueAt: string;
  sourceType: FollowUpSourceType | null;
  sourceId: string | null;
  sourceLabel: string | null;
};

export type FollowUpSource = {
  type: FollowUpSourceType;
  id: string;
  label: string;
};

function toDateTimeInput(value: string): string {
  return formatBerlinDateTimeInput(value);
}

function initialDueAt(): string {
  return tomorrowMorningInBerlin();
}

/** Field errors keyed by control id in visual order; shown after the first submit attempt. */
function followUpDraftErrors(followUpDraft: FollowUpDraft | null) {
  return {
    'follow-up-title':
      followUpDraft && !followUpDraft.title.trim() ? 'Bitte gib einen Titel ein.' : undefined,
    'follow-up-owner':
      followUpDraft && !followUpDraft.ownerUserId ? 'Bitte wähle eine zuständige Person.' : undefined,
    'follow-up-due-date':
      followUpDraft && !parseBerlinDateTimeInput(followUpDraft.dueAt)
        ? 'Bitte gib eine Fälligkeit an.'
        : undefined,
  };
}

/** A blank draft owned by the caller when they may own follow-ups, else by the first owner. */
function newFollowUpDraft(
  followUpOwners: CustomerRelationshipBundle['followUpOwners'],
  currentUserId: string,
  source: FollowUpSource | undefined,
): FollowUpDraft {
  const defaultOwner = followUpOwners.find((owner) => owner.userId === currentUserId) ?? followUpOwners[0];
  return {
    id: null,
    title: '',
    note: '',
    ownerUserId: defaultOwner?.userId ?? '',
    dueAt: initialDueAt(),
    sourceType: source?.type ?? null,
    sourceId: source?.id ?? null,
    sourceLabel: source?.label ?? null,
  };
}

function existingFollowUpDraft(followUp: ClientFollowUp): FollowUpDraft {
  return {
    id: followUp.id,
    title: followUp.title,
    note: followUp.note ?? '',
    ownerUserId: followUp.ownerUserId,
    dueAt: toDateTimeInput(followUp.dueAt),
    sourceType: followUp.sourceType,
    sourceId: followUp.sourceId,
    sourceLabel: followUp.sourceLabel,
  };
}

function followUpInputFromDraft(followUpDraft: FollowUpDraft, dueDate: Date): FollowUpInput {
  return {
    title: followUpDraft.title,
    note: followUpDraft.note,
    ownerUserId: followUpDraft.ownerUserId,
    dueAt: dueDate.toISOString(),
    sourceType: followUpDraft.sourceType ?? undefined,
    sourceId: followUpDraft.sourceId ?? undefined,
  };
}

/** The open follow-ups and the completed or cancelled ones, each memoized on the bundle's list. */
function useSplitFollowUps(followUps: ClientFollowUp[]) {
  const openFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.status === 'open'),
    [followUps],
  );
  const historicFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.status !== 'open'),
    [followUps],
  );
  return { openFollowUps, historicFollowUps };
}

/** Completes or cancels one follow-up while its row shows busy, then waits for the fresh bundle. */
function runFollowUpTransition(
  {
    clientId,
    runRowTask,
    waitForBundle,
    showBanner,
    router,
  }: {
    clientId: string;
    runRowTask: (id: string, task: () => Promise<void>) => Promise<void>;
    waitForBundle: () => Promise<void>;
    showBanner: ReturnType<typeof useBanner>['showBanner'];
    router: ReturnType<typeof useRouter>;
  },
  followUp: ClientFollowUp,
  status: 'completed' | 'cancelled',
): void {
  void runRowTask(followUp.id, async () => {
    const result = await transitionCustomerFollowUp(clientId, followUp.id, status);
    if (!result.success) {
      showBanner({
        variant: 'error',
        message: 'Die Nachfassaktion konnte nicht aktualisiert werden.',
      });
      return;
    }
    showBanner({
      variant: 'success',
      message: status === 'completed' ? 'Nachfassaktion erledigt.' : 'Nachfassaktion abgebrochen.',
    });
    router.refresh();
    await waitForBundle();
  });
}

interface FollowUpEditorState {
  openFollowUps: ClientFollowUp[];
  historicFollowUps: ClientFollowUp[];
  followUpDraft: FollowUpDraft | null;
  setFollowUpDraft: (draft: FollowUpDraft) => void;
  followUpError: string | null;
  followUpTitleError: string | undefined;
  followUpOwnerError: string | undefined;
  followUpDueError: string | undefined;
  openNewFollowUp: (source?: FollowUpSource) => void;
  openExistingFollowUp: (followUp: ClientFollowUp) => void;
  closeFollowUpDialog: () => void;
  saveFollowUp: () => void;
  transitionFollowUp: (followUp: ClientFollowUp, status: 'completed' | 'cancelled') => void;
}

/** The follow-up dialog draft with its validation, save and row transitions. */
export function useFollowUpEditor({
  clientId,
  currentUserId,
  bundle,
  runTask,
  runRowTask,
  waitForBundle,
}: {
  clientId: string;
  currentUserId: string;
  bundle: CustomerRelationshipBundle;
  runTask: (task: () => Promise<void>) => Promise<void>;
  runRowTask: (id: string, task: () => Promise<void>) => Promise<void>;
  waitForBundle: () => Promise<void>;
}): FollowUpEditorState {
  const router = useRouter();
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft | null>(null);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [followUpAttempted, setFollowUpAttempted] = useState(false);
  const followUpErrors = followUpDraftErrors(followUpDraft);
  const followUpTitleError = followUpAttempted ? followUpErrors['follow-up-title'] : undefined;
  const followUpOwnerError = followUpAttempted ? followUpErrors['follow-up-owner'] : undefined;
  const followUpDueError = followUpAttempted ? followUpErrors['follow-up-due-date'] : undefined;
  const { showBanner } = useBanner();

  const { openFollowUps, historicFollowUps } = useSplitFollowUps(bundle.followUps);

  function openNewFollowUp(source?: FollowUpSource): void {
    setFollowUpDraft(newFollowUpDraft(bundle.followUpOwners, currentUserId, source));
  }

  function openExistingFollowUp(followUp: ClientFollowUp): void {
    setFollowUpDraft(existingFollowUpDraft(followUp));
  }

  function closeFollowUpDialog(): void {
    setFollowUpDraft(null);
    setFollowUpError(null);
    setFollowUpAttempted(false);
  }

  function saveFollowUp(): void {
    if (!followUpDraft) return;
    setFollowUpError(null);
    setFollowUpAttempted(true);
    const dueDate = parseBerlinDateTimeInput(followUpDraft.dueAt);
    if (focusFirstInvalidField(followUpErrors) || !dueDate) return;
    const input = followUpInputFromDraft(followUpDraft, dueDate);
    void runTask(async () => {
      const result = followUpDraft.id
        ? await updateCustomerFollowUp(clientId, followUpDraft.id, input)
        : await createCustomerFollowUp(clientId, input);
      if (!result.success) {
        setFollowUpError('Die Nachfassaktion konnte nicht gespeichert werden.');
        return;
      }
      setFollowUpDraft(null);
      showBanner({ variant: 'success', message: 'Nachfassaktion gespeichert.' });
      router.refresh();
      void runRowTask(followUpDraft.id ?? FOLLOW_UP_LIST_ID, waitForBundle);
    });
  }

  function transitionFollowUp(followUp: ClientFollowUp, status: 'completed' | 'cancelled'): void {
    runFollowUpTransition({ clientId, runRowTask, waitForBundle, showBanner, router }, followUp, status);
  }

  return {
    openFollowUps,
    historicFollowUps,
    followUpDraft,
    setFollowUpDraft,
    followUpError,
    followUpTitleError,
    followUpOwnerError,
    followUpDueError,
    openNewFollowUp,
    openExistingFollowUp,
    closeFollowUpDialog,
    saveFollowUp,
    transitionFollowUp,
  };
}
