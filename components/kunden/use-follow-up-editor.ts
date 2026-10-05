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
} from '@/lib/customer-relationships/date-time';
import type {
  ClientFollowUp,
  CustomerRelationshipBundle,
  FollowUpInput,
  FollowUpSourceType,
} from '@/lib/customer-relationships/types';

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
  const followUpTitleError =
    followUpAttempted && followUpDraft && !followUpDraft.title.trim()
      ? 'Bitte gib einen Titel ein.'
      : undefined;
  const followUpOwnerError =
    followUpAttempted && followUpDraft && !followUpDraft.ownerUserId
      ? 'Bitte wähle eine zuständige Person.'
      : undefined;
  const followUpDueError =
    followUpAttempted && followUpDraft && !parseBerlinDateTimeInput(followUpDraft.dueAt)
      ? 'Bitte gib eine Fälligkeit an.'
      : undefined;
  const { showBanner } = useBanner();

  const openFollowUps = useMemo(
    () => bundle.followUps.filter((followUp) => followUp.status === 'open'),
    [bundle.followUps],
  );
  const historicFollowUps = useMemo(
    () => bundle.followUps.filter((followUp) => followUp.status !== 'open'),
    [bundle.followUps],
  );

  function openNewFollowUp(source?: FollowUpSource): void {
    const defaultOwner =
      bundle.followUpOwners.find((owner) => owner.userId === currentUserId) ?? bundle.followUpOwners[0];
    setFollowUpDraft({
      id: null,
      title: '',
      note: '',
      ownerUserId: defaultOwner?.userId ?? '',
      dueAt: initialDueAt(),
      sourceType: source?.type ?? null,
      sourceId: source?.id ?? null,
      sourceLabel: source?.label ?? null,
    });
  }

  function openExistingFollowUp(followUp: ClientFollowUp): void {
    setFollowUpDraft({
      id: followUp.id,
      title: followUp.title,
      note: followUp.note ?? '',
      ownerUserId: followUp.ownerUserId,
      dueAt: toDateTimeInput(followUp.dueAt),
      sourceType: followUp.sourceType,
      sourceId: followUp.sourceId,
      sourceLabel: followUp.sourceLabel,
    });
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
    if (!followUpDraft.title.trim() || !followUpDraft.ownerUserId || !dueDate) {
      const firstInvalidId = !followUpDraft.title.trim()
        ? 'follow-up-title'
        : !followUpDraft.ownerUserId
          ? 'follow-up-owner'
          : 'follow-up-due-date';
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    const input: FollowUpInput = {
      title: followUpDraft.title,
      note: followUpDraft.note,
      ownerUserId: followUpDraft.ownerUserId,
      dueAt: dueDate.toISOString(),
      sourceType: followUpDraft.sourceType ?? undefined,
      sourceId: followUpDraft.sourceId ?? undefined,
    };
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
