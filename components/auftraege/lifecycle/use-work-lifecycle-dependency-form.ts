'use client';

import { useState, type FormEvent } from 'react';

import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { saveWorkDependency, searchWorkPredecessors } from '@/lib/work-lifecycle/actions';
import type {
  WorkDeclaredDependencyKind,
  WorkDependencyEffect,
  WorkEntityOption,
  WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import { PREDECESSOR_SEARCH_FAILED_MESSAGE, workLifecycleErrorMessage } from './work-lifecycle-messages';

export type WorkDependencyDialogProps = {
  snapshot: WorkLifecycleSnapshot;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

type WorkDependencyPredecessorType = 'job' | 'project' | 'instruction' | 'declared';

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
  // From two characters the server searches; a newer keystroke cancels the waiting read.
  const predecessorSearch = useClientRead({
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
      return searchWorkPredecessors({ type, query: search });
    },
    deps: [type, search],
    enabled: type !== 'declared' && search.trim().length >= 2,
    failureMessage: PREDECESSOR_SEARCH_FAILED_MESSAGE,
    // The last answer stays listed while the next search runs.
    keepPreviousData: true,
  });
  const [attempted, setAttempted] = useState(false);
  const fieldErrors = {
    'dependency-target': predecessor ? undefined : 'Bitte wähle eine Voraussetzung.',
    'dependency-description':
      type === 'declared' && description.trim().length < 3
        ? 'Bitte beschreibe die Bedingung mit mindestens 3 Zeichen.'
        : undefined,
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(fieldErrors)) return;
    void runDependencyTask(async () => {
      const result = await saveWorkDependency({
        targetType: snapshot.targetType,
        targetId: snapshot.targetId,
        predecessor:
          type === 'declared'
            ? { type, kind: predecessor as WorkDeclaredDependencyKind }
            : { type, id: predecessor },
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
