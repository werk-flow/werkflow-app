'use client';

import type { ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';

type PendingSubmitButtonProps = Omit<
  ComponentProps<typeof Button>,
  'asChild' | 'disabled' | 'type'
> & {
  disabled?: boolean;
  pendingLabel?: string;
};

/**
 * Submit control for a React/Next Server Action form. The clicked control keeps
 * its label and adds an inline status spinner until the action has settled;
 * sibling submit controls are disabled for the same interval.
 */
export function PendingSubmitButton({
  children,
  disabled = false,
  name,
  pendingLabel = 'Wird gespeichert',
  value,
  ...props
}: PendingSubmitButtonProps) {
  const { data, pending } = useFormStatus();
  const submittedValue = name ? data?.get(name) : null;
  const isOwnSubmission =
    pending &&
    (!name ||
      (typeof value !== 'undefined' && String(submittedValue) === String(value)));

  return (
    <Button
      {...props}
      type="submit"
      name={name}
      value={value}
      disabled={disabled || pending}
      aria-busy={isOwnSubmission || undefined}
      data-pending={isOwnSubmission ? 'true' : 'false'}
    >
      <InlinePending active={isOwnSubmission} label={pendingLabel} />
      {children}
    </Button>
  );
}
