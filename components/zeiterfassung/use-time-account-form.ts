'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import {
  getTimeAccountFailureMessage,
  type TimeAccountAction,
  type TimeAccountActionResult,
  type TimeAccountFailureCode,
} from '@/lib/time-accounts/messages';

/**
 * Submit flow of a time-account settings form with several submit buttons:
 * the clicked button's name and value travel with the fields, `pendingValue`
 * names it for its spinner in the first frame, a refusal stays at the form as
 * `error`, and a success shows the banner and resets the uncontrolled fields.
 * `handleKeyDown` stops Enter in a text field from submitting through the
 * first button, so every submission carries a choice the user clicked.
 */
export function useTimeAccountForm<Action extends TimeAccountAction>({
  action,
  serverAction,
  fallback,
  successMessage,
}: {
  action: Action;
  serverAction: (formData: FormData) => Promise<TimeAccountActionResult<Action>>;
  fallback: TimeAccountFailureCode<Action>;
  successMessage: (formData: FormData) => string;
}): {
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  isPending: boolean;
  pendingValue: string | null;
  error: string | null;
} {
  const { showBanner } = useBanner();
  const [error, setError] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const { run, isPending } = useServerAction(serverAction);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const nativeEvent = event.nativeEvent;
    const submitter =
      'submitter' in nativeEvent && nativeEvent.submitter instanceof HTMLElement
        ? nativeEvent.submitter
        : null;
    const formData = new FormData(form, submitter);
    setPendingValue(submitter?.getAttribute('value') ?? null);
    try {
      const result = await run(formData);
      if (!result.success) {
        setError(getTimeAccountFailureMessage(action, result.error));
        return;
      }
      form.reset();
      showBanner({ variant: 'success', message: successMessage(formData) });
    } catch {
      setError(getTimeAccountFailureMessage(action, fallback));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
  };

  return { handleSubmit, handleKeyDown, isPending, pendingValue, error };
}
