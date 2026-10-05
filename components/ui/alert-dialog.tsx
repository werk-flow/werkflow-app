'use client';

import * as React from 'react';
import type { VariantProps } from 'class-variance-authority';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { RegisterOpenDialog } from '@/components/ui/open-dialog-context';

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
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const pending = React.useContext(AlertDialogPendingContext);
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg',
          className,
        )}
        {...props}
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

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-lg font-semibold', className)}
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
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<VariantProps<typeof buttonVariants>, 'variant'>) {
  return <AlertDialogPrimitive.Action className={cn(buttonVariants({ variant }), className)} {...props} />;
}

function AlertDialogCancel({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  const pending = React.useContext(AlertDialogPendingContext);
  return (
    <AlertDialogPrimitive.Cancel
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
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
