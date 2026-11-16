'use client';

import { useState, type ReactNode } from 'react';
import type { VariantProps } from 'class-variance-authority';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { buttonVariants } from '@/components/ui/button';
import { useServerAction } from '@/hooks/use-server-action';
import { logError } from '@/lib/logging';

const UNEXPECTED_FAILURE = 'Das hat nicht geklappt. Bitte versuche es erneut.';

/**
 * What the confirm does. By default it awaits the request: `onConfirm`
 * answers `null` when the step is done, or the German message to show.
 *
 * `closesAtOnce` is the one exception (werkflow-design: Dialog close and
 * success): the confirmation closes on the click because the surface under it
 * shows the step, its pending state and its failure, such as an optimistic
 * row that comes back with its error. It never fits a step whose failure
 * would show nowhere else.
 */
export type ConfirmActionStep =
  | { closesAtOnce?: false; onConfirm: () => Promise<string | null> }
  | { closesAtOnce: true; onConfirm: () => void };

/** Runs the confirm, closes on success, and keeps the failure while the dialog stays open. */
function useConfirmStep(step: ConfirmActionStep, isOpen: boolean, close: () => void) {
  const [error, setError] = useState<string | null>(null);
  // A closed dialog forgets its failure, also when the parent closed it.
  const [shownOpen, setShownOpen] = useState(isOpen);
  if (shownOpen !== isOpen) {
    setShownOpen(isOpen);
    if (!isOpen) setError(null);
  }
  const { run, isPending } = useServerAction(() =>
    step.closesAtOnce ? Promise.resolve(null) : step.onConfirm(),
  );

  async function confirm() {
    if (step.closesAtOnce) {
      step.onConfirm();
      close();
      return;
    }
    setError(null);
    let failure: string | null;
    try {
      failure = await run();
    } catch (cause) {
      logError('confirm action: the request failed', cause);
      failure = UNEXPECTED_FAILURE;
    }
    if (failure === null) close();
    else setError(failure);
  }

  return { confirm, isPending, error };
}

/**
 * A confirmation whose action runs a request: it stays open while the request
 * runs and after a failure, shows that failure in its footer, and closes only
 * on success (werkflow-design: Dialog close and success). A thrown request
 * shows a general message and keeps the dialog open.
 *
 * Open it with `trigger`, or control it with `open` and `onOpenChange`. Lint
 * rule `ui/confirm-action-stays-open` sends every confirm with work here.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  confirmLabel,
  variant = 'default',
  confirmDisabled = false,
  ...step
}: ConfirmActionStep & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The control that opens the dialog; it takes the trigger's role through `asChild`. */
  trigger?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  /** Content between the description and the footer, such as a list of what the step affects. */
  children?: ReactNode;
  confirmLabel: ReactNode;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  confirmDisabled?: boolean;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  function changeOpen(next: boolean) {
    setOwnOpen(next);
    onOpenChange?.(next);
  }
  const { confirm, isPending, error } = useConfirmStep(step, isOpen, () => changeOpen(false));

  return (
    <AlertDialog open={isOpen} onOpenChange={changeOpen} pending={isPending}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {/* A div, so a description may hold its own paragraphs or a list. */}
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter error={error}>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant={variant}
            pending={isPending}
            disabled={confirmDisabled}
            onClick={(event) => {
              // The primitive closes on activation; the request decides instead.
              event.preventDefault();
              void confirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
