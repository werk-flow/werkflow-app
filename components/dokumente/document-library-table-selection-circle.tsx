'use client';

import type { ReactElement } from 'react';
import { Check } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { cn } from '@/lib/utils';

/** Outline of the selection circle; revealed on row hover like the loaded control. */
export function SkeletonSelectionCircle({ visible = false }: { visible?: boolean }): ReactElement {
  return (
    <span
      className={cn(
        'flex size-5 items-center justify-center rounded-full border border-muted-foreground/45 bg-background transition-opacity',
        visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
      )}
    />
  );
}

type SelectionCircleProps = {
  checked: boolean;
  alwaysVisible?: boolean;
  label: string;
  onClick: () => void;
};

export function SelectionCircle({
  checked,
  alwaysVisible = false,
  label,
  onClick,
}: SelectionCircleProps): ReactElement {
  return (
    <PlainButton
      type="button"
      aria-pressed={checked}
      aria-label={label}
      data-table-interactive="true"
      data-document-selection-circle="true"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className={cn(
        'flex size-5 cursor-pointer items-center justify-center rounded-full border transition-all',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-muted-foreground/50 bg-background text-transparent hover:border-primary',
        checked || alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
      )}
    >
      {checked && <Check className="size-3.5" />}
    </PlainButton>
  );
}
