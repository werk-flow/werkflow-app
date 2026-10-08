'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { workLifecycleErrorMessage } from './work-lifecycle-messages';

type ReasonDialogProps = {
  title: string;
  description: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<{ success: boolean; error?: string }>;
};

export function ReasonDialog({ title, description, submitLabel, onClose, onSubmit }: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run: runReasonTask, isPending: pending } = usePendingTask();
  const [attempted, setAttempted] = useState(false);
  const reasonError = reason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField({ 'work-reason': reasonError })) return;
    void runReasonTask(async () => {
      const result = await onSubmit(reason.trim());
      if (!result.success) {
        setError(workLifecycleErrorMessage(result.error ?? ''));
        return;
      }
      onClose();
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={pending}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2 py-1">
            <Field
              label="Begründung"
              htmlFor="work-reason"
              required
              error={attempted ? reasonError : undefined}
            >
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                required
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button pending={pending} type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
