'use client';

import * as React from 'react';
import type { VariantProps } from 'class-variance-authority';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { RegisterOpenDialog } from '@/components/ui/open-dialog-context';
import { useReturnFocus } from '@/components/ui/return-focus';
import { Spinner } from '@/components/ui/spinner';
import { ErrorText } from '@/components/ui/error-text';

/** True while the confirmation's request runs; see `AlertDialog`'s `pending`. */
const AlertDialogPendingContext = React.createContext(false);

/**
 * `pending` keeps the confirmation open while its request runs: Escape and
 * Cancel cannot close it, so the failure still lands in a visible dialog.
 * Bind it to the flag that disables the action, and keep the action open with
 * `event.preventDefault()` until the request settles.
 */
function AlertDialog({
  pending = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root> & { pending?: boolean }) {
  return (
    <AlertDialogPendingContext.Provider value={pending}>
      <AlertDialogPrimitive.Root
        data-slot="alert-dialog"
        {...props}
        onOpenChange={(open) => {
          if (!open && pending) return;
          onOpenChange?.(open);
        }}
      />
    </AlertDialogPendingContext.Provider>
  );
}

function AlertDialogTrigger({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  children,
  onEscapeKeyDown,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const pending = React.useContext(AlertDialogPendingContext);
  const returnFocus = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 flex w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col gap-4 rounded-lg border p-6 shadow-lg duration-200 wrap-anywhere sm:max-w-lg',
          // Never grow past the viewport. A plain confirmation scrolls as a
          // whole under its sticky footer; an AlertDialogBody child takes
          // over scrolling, so the header stays in view too.
          'max-h-[calc(100dvh-3rem)] overflow-y-auto has-[[data-slot=alert-dialog-body]]:overflow-hidden',
          className,
        )}
        {...props}
        {...returnFocus}
        // The refused dismissal is observable: assistive technology and the
        // browser tests' settle step wait on it instead of on time.
        aria-busy={pending || undefined}
        data-pending={pending ? 'true' : undefined}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
          onEscapeKeyDown?.(event);
        }}
      >
        {/* Suspends Realtime router refreshes while open; must sit inside the
            presence-gated primitive content (see open-dialog-context.tsx). */}
        <RegisterOpenDialog />
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

/**
 * Scrollable middle region of a long confirmation, as `DialogBody` is for a
 * dialog: AlertDialogHeader and AlertDialogFooter stay, only this body
 * scrolls. The negative margins with matching padding keep the scrollbar at
 * the edge and give a field's focus ring room the scroll container would clip.
 */
function AlertDialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-body"
      className={cn('-mx-6 -my-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-1', className)}
      {...props}
    />
  );
}

const FOOTER_ACTIONS = 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';

/**
 * Sticks to the bottom of a confirmation that scrolls as a whole, so its
 * actions stay in reach without an AlertDialogBody. The negative margins with
 * matching padding cover the content's padding, so text scrolls under the
 * footer instead of showing below it. A failed confirm shows its `error` here,
 * above the actions: as content before the footer it could sit out of view.
 */
function AlertDialogFooter({
  className,
  error,
  children,
  ...props
}: React.ComponentProps<'div'> & { error?: React.ReactNode }) {
  const sticky = 'bg-background sticky -bottom-6 -mx-6 -mb-6 px-6 pb-6';
  if (!error)
    return (
      <div data-slot="alert-dialog-footer" className={cn(sticky, FOOTER_ACTIONS, className)} {...props}>
        {children}
      </div>
    );
  return (
    <div data-slot="alert-dialog-footer" className={cn(sticky, 'flex flex-col gap-2')} {...props}>
      <ErrorText>{error}</ErrorText>
      <div className={cn(FOOTER_ACTIONS, className)}>{children}</div>
    </div>
  );
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      // An e-mail address or a record number is one long word; it wraps instead of widening the layer.
      className={cn('text-lg font-semibold wrap-anywhere', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-muted-foreground text-sm wrap-anywhere', className)}
      {...props}
    />
  );
}

/**
 * The confirming action of an AlertDialog. `pending` works as on `Button`: the
 * action turns busy and disabled, and a spinner takes the place of its leading
 * icon, so a running deletion never swaps in a spinner by hand.
 */
function AlertDialogAction({
  className,
  variant,
  pending = false,
  disabled,
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<VariantProps<typeof buttonVariants>, 'variant'> & { pending?: boolean }) {
  // A slotted child renders its own content, so it cannot take the spinner.
  const busy = pending && !asChild;
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(
        buttonVariants({ variant }),
        busy && '[&>svg:not([data-slot=spinner])]:hidden',
        className,
      )}
      disabled={disabled || busy || undefined}
      aria-busy={busy || undefined}
      {...(asChild === undefined ? {} : { asChild })}
      {...props}
    >
      {busy ? (
        <>
          <Spinner />
          {children}
        </>
      ) : (
        children
      )}
    </AlertDialogPrimitive.Action>
  );
}

function AlertDialogCancel({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  const pending = React.useContext(AlertDialogPendingContext);
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      disabled={pending || disabled}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
