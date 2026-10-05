'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { usePendingTask, useServerAction } from '@/hooks/use-server-action';
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

type WorkLifecycleDependencyForm = {
  type: WorkDependencyPredecessorType;
  setType: (type: WorkDependencyPredecessorType) => void;
  predecessor: string;
  setPredecessor: (predecessor: string) => void;
  effect: WorkDependencyEffect;
  setEffect: (effect: WorkDependencyEffect) => void;
  description: string;
  setDescription: (description: string) => void;
  remoteOptions: WorkEntityOption[] | null;
  setRemoteOptions: (options: WorkEntityOption[] | null) => void;
  setSearch: (search: string) => void;
  error: string | null;
  pending: boolean;
  searching: boolean;
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
  const [remoteOptions, setRemoteOptions] = useState<WorkEntityOption[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run: runDependencyTask, isPending: pending } = usePendingTask();
  const { run: runSearch, isPending: searching } = useServerAction(searchWorkPredecessors);
  useEffect(() => {
    if (type === 'declared' || search.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void runSearch({ type, query: search })
        .then((result) => {
          if (cancelled) return;
          if (!result.success) {
            setError(PREDECESSOR_SEARCH_FAILED_MESSAGE);
            return;
          }
          setRemoteOptions(result.options);
          // A successful search retires an earlier search failure, never a save failure.
          setError((current) => (current === PREDECESSOR_SEARCH_FAILED_MESSAGE ? null : current));
        })
        .catch(() => {
          if (!cancelled) setError(PREDECESSOR_SEARCH_FAILED_MESSAGE);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runSearch, search, type]);
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
    remoteOptions,
    setRemoteOptions,
    setSearch,
    error,
    pending,
    searching,
    attempted,
    fieldErrors,
    submit,
  };
}
