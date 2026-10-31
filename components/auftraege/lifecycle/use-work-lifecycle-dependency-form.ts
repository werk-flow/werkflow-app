'use client';

import { useState, type FormEvent } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { readInBackground } from '@/lib/data/background-read-client';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { saveWorkDependency } from '@/lib/work-lifecycle/actions';
import {
  WORK_DECLARED_DEPENDENCY_KINDS,
  type WorkDependencyEffect,
  type WorkEntityOption,
  type WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import { PREDECESSOR_SEARCH_FAILED_MESSAGE, workLifecycleErrorMessage } from './work-lifecycle-messages';

export type WorkDependencyDialogProps = {
  snapshot: WorkLifecycleSnapshot;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

/** The kinds of predecessor the dialog's „Art“ select offers. */
export const WORK_DEPENDENCY_PREDECESSOR_TYPES = ['job', 'project', 'instruction', 'declared'] as const;

type WorkDependencyPredecessorType = (typeof WORK_DEPENDENCY_PREDECESSOR_TYPES)[number];

type WorkDependencyPredecessor = Parameters<typeof saveWorkDependency>[0]['predecessor'];

const PREDECESSOR_SEARCH_DELAY_MS = 200;

type WorkLifecycleDependencyForm = {
  type: WorkDependencyPredecessorType;
  setType: (type: WorkDependencyPredecessorType) => void;
  predecessor: string;
  setPredecessor: (predecessor: string) => void;
  effect: WorkDependencyEffect;
  setEffect: (effect: WorkDependencyEffect) => void;
  description: string;
  setDescription: (description: string) => void;
  /** The server's answer from two typed characters on; null below that. */
  remoteOptions: WorkEntityOption[] | null;
  search: string;
  setSearch: (search: string) => void;
  error: string | null;
  pending: boolean;
  searching: boolean;
  searchFailure: ReadFailure | null;
  attempted: boolean;
  fieldErrors: {
    'dependency-target': string | undefined;
    'dependency-description': string | undefined;
  };
  submit: (event: FormEvent) => void;
};

/**
 * The predecessor search: from two typed characters the server searches over
 * the background-read route after a short pause, and a newer keystroke
 * cancels the waiting read. The last answer stays listed while the next runs.
 */
function usePredecessorSearch(type: WorkDependencyPredecessorType, search: string) {
  const { activeOrgId } = useOrganization();
  return useClientRead({
    read: async (signal) => {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, PREDECESSOR_SEARCH_DELAY_MS);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      // A declared condition is never searched; `enabled` keeps the read off for it.
      if (signal.aborted || type === 'declared') return { success: false as const, error: 'superseded' };
      const input = { organizationId: activeOrgId ?? '', type, query: search };
      return readInBackground('work-predecessor-search', input, signal);
    },
    deps: [activeOrgId, type, search],
    enabled: type !== 'declared' && search.trim().length >= 2,
    failureMessage: PREDECESSOR_SEARCH_FAILED_MESSAGE,
    keepPreviousData: true,
  });
}

/**
 * The chosen predecessor as the save expects it, or null while none is chosen.
 * A declared condition takes its kind from the select's options, which list
 * every declared kind.
 */
function chosenPredecessor(
  type: WorkDependencyPredecessorType,
  predecessor: string,
): WorkDependencyPredecessor | null {
  if (type !== 'declared') return predecessor ? { type, id: predecessor } : null;
  const kind = WORK_DECLARED_DEPENDENCY_KINDS.find((candidate) => candidate === predecessor);
  return kind ? { type, kind } : null;
}

/** State, debounced predecessor search, validation and save of the dependency dialog. */
export function useWorkLifecycleDependencyForm({
  snapshot,
  onClose,
  onChanged,
}: WorkDependencyDialogProps): WorkLifecycleDependencyForm {
  const [type, setType] = useState<'job' | 'project' | 'instruction' | 'declared'>('job');
  const [predecessor, setPredecessor] = useState('');
  const [effect, setEffect] = useState<WorkDependencyEffect>('blocks_start');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run: runDependencyTask, isPending: pending } = usePendingTask();
  const predecessorSearch = usePredecessorSearch(type, search);
  const [attempted, setAttempted] = useState(false);
  const chosen = chosenPredecessor(type, predecessor);
  const fieldErrors = {
    'dependency-target': chosen ? undefined : 'Bitte wähle eine Voraussetzung.',
    'dependency-description':
      type === 'declared' && description.trim().length < 3
        ? 'Bitte beschreibe die Bedingung mit mindestens 3 Zeichen.'
        : undefined,
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(fieldErrors) || !chosen) return;
    void runDependencyTask(async () => {
      const result = await saveWorkDependency({
        targetType: snapshot.targetType,
        targetId: snapshot.targetId,
        predecessor: chosen,
        ...(description.trim() ? { description: description.trim() } : {}),
        effect,
      });
      if (!result.success) {
        setError(workLifecycleErrorMessage(result.error));
        return;
      }
      await onChanged();
      onClose();
    });
  };
  return {
    type,
    setType,
    predecessor,
    setPredecessor,
    effect,
    setEffect,
    description,
    setDescription,
    remoteOptions: predecessorSearch.data?.options ?? null,
    search,
    setSearch,
    error,
    pending,
    searching: predecessorSearch.loading,
    searchFailure: predecessorSearch.failure,
    attempted,
    fieldErrors,
    submit,
  };
}
