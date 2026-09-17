'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RegisterOpenDialog } from '@/components/ui/open-dialog-context';

const Dialog = DialogPrimitive.Root;

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
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogPlacement = 'center' | 'anchored';

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * `center` is the ordinary modal. `anchored` keeps the mobile sheet and,
     * from the tablet breakpoint up, sits above the clock button at the bottom
     * right like a popover, so the page stays in view behind a lighter overlay.
     */
    placement?: DialogPlacement;
  }
>(({ className, children, placement = 'center', ...props }, ref) => {
  return (
    <DialogPortal>
      <DialogOverlay className={placement === 'anchored' ? 'sm:bg-black/30' : undefined} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // Mobile: full width at bottom like a sheet
          'fixed inset-x-0 bottom-0 z-50 flex w-full flex-col gap-4 border-t bg-background p-4 shadow-lg duration-200',
          // Never grow past the viewport. Plain dialogs scroll as a whole;
          // a DialogBody child takes over scrolling (fixed header/footer).
          'max-h-[calc(100dvh-3rem)] overflow-y-auto has-[[data-slot=dialog-body]]:overflow-hidden',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          'rounded-t-xl',
          'sm:max-h-[90vh] sm:rounded-lg sm:border sm:border-t',
          placement === 'center'
            ? [
                // Desktop: centered modal
                'sm:inset-auto sm:left-[50%] sm:top-[50%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:p-6',
                'sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%]',
                'sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]',
                'sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95',
              ]
            : [
                // Desktop: anchored above the clock button
                'sm:inset-auto sm:bottom-24 sm:right-6 sm:w-96 sm:max-w-[calc(100vw-3rem)] sm:p-6',
                'sm:data-[state=closed]:slide-out-to-bottom-2 sm:data-[state=open]:slide-in-from-bottom-2',
              ],
          className
        )}
        {...props}
      >
        {/* Suspends Realtime router refreshes while open. Must sit INSIDE the
            presence-gated primitive content — the wrapper body runs even for
            closed dialogs (see open-dialog-context.tsx). */}
        <RegisterOpenDialog />
        {/* Mobile drag handle */}
        <div className="mx-auto h-1.5 w-12 shrink-0 rounded-full bg-muted sm:hidden" />
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-0 focus:ring-offset-0 disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Schließen</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * Scrollable middle region for long form dialogs (interaction canon in the
 * werkflow-design skill): DialogHeader and DialogFooter stay fixed, only this
 * body scrolls. The negative horizontal margin keeps the scrollbar at the
 * dialog edge; the negative vertical margin with matching padding gives the
 * first and last rows room for a 2 px focus or selection ring, which the
 * scroll container would otherwise clip (pre-Wave-3 step 3 reproduction).
 */
const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div
    data-slot="dialog-body"
    className={cn(
      'min-h-0 flex-1 overflow-y-auto overscroll-contain -mx-4 -my-1 px-4 py-1 sm:-mx-6 sm:px-6',
      className
    )}
    {...props}
  />
);
DialogBody.displayName = 'DialogBody';

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className
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
    className={cn(
      'text-lg font-semibold leading-none tracking-tight',
      className
    )}
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
    className={cn('text-sm text-muted-foreground', className)}
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
  DialogDescription
};
