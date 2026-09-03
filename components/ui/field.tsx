'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The one label-plus-control stack. Before 2026-09-03 seventy-six files
 * hand-built it with three spellings, and the files that used a bare `div`
 * shipped labels glued to their inputs. `Field` owns the gap, the required
 * marker, the helper text, the error slot, and the ARIA wiring; `Input`,
 * `Textarea`, and the registry controls read the context so callers pass
 * nothing twice.
 */

interface FieldContextValue {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** Control id. Generated when omitted; the control reads it from context. */
  htmlFor?: string;
  required?: boolean;
  /** Short helper text under the control, wired via `aria-describedby`. */
  description?: ReactNode;
  /** Field-level error, rendered as `ErrorText` and wired via `aria-describedby`. */
  error?: ReactNode;
  /** Visually hidden label (search fields with a placeholder that says it all). */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  htmlFor,
  required = false,
  description,
  error,
  hideLabel = false,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const controlId = htmlFor ?? generatedId;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, descriptionId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider
      value={{ controlId, describedBy, invalid: Boolean(error), required }}
    >
      <div data-slot="field" className={cn('grid gap-2', className)}>
        <Label htmlFor={controlId} className={cn(hideLabel && 'sr-only')}>
          <span>
            {label}
            {required && (
              <span aria-hidden="true" className="text-muted-foreground">
                {' '}
                *
              </span>
            )}
          </span>
        </Label>
        {children}
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
        <ErrorText id={errorId}>{error}</ErrorText>
      </div>
    </FieldContext.Provider>
  );
}
