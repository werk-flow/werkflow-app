'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RegisterOpenDialog } from '@/components/ui/open-dialog-context';
import { useReturnFocus } from '@/components/ui/return-focus';

/** True while the dialog's request runs; see `Dialog`'s `pending`. */
const DialogPendingContext = React.createContext(false);

/**
 * `pending` keeps the dialog open while its request runs: Escape, an outside
 * click and the close button cannot close it, so the result or the failure
 * still lands in a visible dialog (third review pass, five Mitarbeiter
 * dialogs). Bind it to the same flag that disables the submit.
 */
function Dialog({
  pending = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { pending?: boolean }): React.JSX.Element {
  return (
    <DialogPendingContext.Provider value={pending}>
      <DialogPrimitive.Root
        {...props}
        onOpenChange={(open) => {
          if (!open && pending) return;
          onOpenChange?.(open);
        }}
      />
    </DialogPendingContext.Provider>
  );
}

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogPlacement = 'center' | 'anchored';

type DialogInitialFocus = 'first-control' | 'dialog';

const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Where focus lands when the dialog opens. Radix focuses the first control
 * that exists and is enabled at that moment; while the fields still load (a
 * `Skeleton` stands in for them) or stay disabled until a read ends, that is
 * the footer's „Abbrechen“ or the close button, and focus stayed there once
 * the fields arrived (rendered dialog audit). Such a dialog, and one that asks
 * for it with `initialFocus="dialog"`, focuses itself instead: the first Tab
 * then reaches its first control.
 */
function focusDialogInstead(event: Event, initialFocus: DialogInitialFocus): void {
  if (event.defaultPrevented) return;
  const content = event.currentTarget;
  if (!(content instanceof HTMLElement)) return;
  const fieldsPending =
    content.querySelector('[data-slot="skeleton"]') !== null ||
    content.querySelector(TABBABLE)?.getAttribute('data-slot') === 'dialog-close';
  if (initialFocus === 'first-control' && !fieldsPending) return;
  event.preventDefault();
  content.focus();
}

// The allowed desktop widths of a centered dialog. Call sites pick one through
// `size`; a `max-w-*` class on DialogContent is a lint error, because 111
// dialogs had drifted into 14 widths, six of them arbitrary pixel values
// (2026-10-01). Confirmations and one-field forms use `md`, ordinary forms
// the default `lg`, two-column editors `2xl` and wider.
const DIALOG_SIZE_CLASS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl',
  // A two-pane browser (the document move destination) spans the window up to 80rem.
  window: 'sm:w-[min(80rem,calc(100vw-3rem))] sm:max-w-none',
} as const;

type DialogContentLayout = {
  placement: DialogPlacement;
  workspace: boolean;
  size: keyof typeof DIALOG_SIZE_CLASS;
  className: string | undefined;
};

function dialogContentClassName({ placement, workspace, size, className }: DialogContentLayout): string {
  return cn(
    // Mobile: full width at bottom like a sheet
    'fixed inset-x-0 bottom-0 z-50 flex w-full flex-col gap-4 border-t bg-background p-4 shadow-lg duration-200 wrap-anywhere',
    // Never grow past the viewport. Plain dialogs scroll as a whole;
    // a DialogBody child takes over scrolling (fixed header/footer).
    'max-h-[calc(100dvh-3rem)] overflow-y-auto has-[[data-slot=dialog-body]]:overflow-hidden',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
    'rounded-t-lg',
    'sm:max-h-[90dvh] sm:rounded-lg sm:border sm:border-t',
    workspace && 'h-[min(44rem,calc(100dvh-3rem))]',
    placement === 'center'
      ? [
          // Desktop: centered modal
          'sm:inset-auto sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:p-6',
          DIALOG_SIZE_CLASS[size],
          'sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%]',
          'sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]',
          'sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95',
        ]
      : [
          // Desktop: anchored above the clock button
          'sm:inset-auto sm:bottom-24 sm:right-6 sm:w-96 sm:max-w-[calc(100vw-3rem)] sm:p-6',
          'sm:data-[state=closed]:slide-out-to-bottom-2 sm:data-[state=open]:slide-in-from-bottom-2',
        ],
    className,
  );
}

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * `center` is the ordinary modal. `anchored` keeps the mobile sheet and,
     * from the tablet breakpoint up, sits above the clock button at the bottom
     * right like a popover, so the page stays in view behind a lighter overlay.
     */
    placement?: DialogPlacement;
    /** Fixed workspace for tabbed forms; only the body scrolls as content changes. */
    workspace?: boolean;
    /** Desktop width of a centered dialog. */
    size?: keyof typeof DIALOG_SIZE_CLASS;
    /**
     * `first-control` (default) focuses the first control, or the dialog while
     * its fields load. `dialog` focuses the dialog itself, for content whose
     * first control appears late (the avatar crop area).
     */
    initialFocus?: DialogInitialFocus;
  }
>(
  (
    {
      className,
      children,
      placement = 'center',
      workspace = false,
      size = 'lg',
      initialFocus = 'first-control',
      onEscapeKeyDown,
      onInteractOutside,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const pending = React.useContext(DialogPendingContext);
    const returnFocus = useReturnFocus({
      onOpenAutoFocus: (event) => {
        onOpenAutoFocus?.(event);
        focusDialogInstead(event, initialFocus);
      },
      onCloseAutoFocus,
    });
    return (
      <DialogPortal>
        <DialogOverlay className={placement === 'anchored' ? 'sm:bg-black/30' : undefined} />
        <DialogPrimitive.Content
          ref={ref}
          data-slot="dialog-content"
          className={dialogContentClassName({ placement, workspace, size, className })}
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
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
            onInteractOutside?.(event);
          }}
        >
          {/* Suspends Realtime router refreshes while open. Must sit INSIDE the
            presence-gated primitive content — the wrapper body runs even for
            closed dialogs (see open-dialog-context.tsx). */}
          <RegisterOpenDialog />
          {/* Mobile drag handle */}
          <div className="mx-auto h-1.5 w-12 shrink-0 rounded-full bg-muted sm:hidden" />
          {children}
          <DialogPrimitive.Close
            data-slot="dialog-close"
            disabled={pending}
            className="absolute right-1.5 top-1.5 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none sm:right-3 sm:top-3 sm:size-8"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Schließen</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * Scrollable middle region for long form dialogs (interaction canon in the
 * werkflow-design skill): DialogHeader and DialogFooter stay fixed, only this
 * body scrolls. The negative horizontal margin keeps the scrollbar at the
 * dialog edge; the negative vertical margin with matching padding gives the
 * first and last rows room for a 2 px focus or selection ring, which the
 * scroll container would otherwise clip (pre-Wave-3 step 3 reproduction).
 */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div
    data-slot="dialog-body"
    className={cn(
      'min-h-0 flex-1 overflow-y-auto overscroll-contain -mx-4 -my-1 px-4 py-1 sm:-mx-6 sm:px-6',
      className,
    )}
    {...props}
  />
);
DialogBody.displayName = 'DialogBody';

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-footer"
    className={cn(
      'flex flex-col-reverse gap-2 [&_[data-slot=button]]:min-h-11 sm:flex-row sm:flex-wrap sm:justify-end sm:[&_[data-slot=button]]:min-h-0',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    // An e-mail address or a record number is one long word; it wraps instead of widening the layer.
    className={cn('text-lg font-semibold leading-none tracking-tight wrap-anywhere', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground wrap-anywhere', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
