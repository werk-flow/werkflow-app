'use client';

import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';

type TimeAccountSubmitButtonProps = Omit<ComponentProps<typeof Button>, 'asChild' | 'disabled' | 'type'> & {
  /** `isPending` and `pendingValue` of `useTimeAccountForm`. */
  isPending: boolean;
  pendingValue: string | null;
  pendingLabel: string;
};

/**
 * A submit button of a `useTimeAccountForm` form: the clicked button shows the
 * spinner, every button of the form is disabled while the action runs.
 */
export function TimeAccountSubmitButton({
  isPending,
  pendingValue,
  pendingLabel,
  value,
  children,
  ...props
}: TimeAccountSubmitButtonProps) {
  const isOwnSubmission =
    isPending && (value === undefined ? pendingValue === null : String(value) === pendingValue);
  return (
    <Button
      {...props}
      type="submit"
      value={value}
      disabled={isPending}
      aria-busy={isOwnSubmission || undefined}
    >
      <InlinePending active={isOwnSubmission} label={pendingLabel} />
      {children}
    </Button>
  );
}
