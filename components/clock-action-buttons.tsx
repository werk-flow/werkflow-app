'use client';

import {
  ArrowLeftRight,
  BriefcaseBusiness,
  Coffee,
  Play,
  Route,
  SlidersHorizontal,
  Square,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ClockAction, ClockActionIcon } from '@/lib/time-tracking/clock-actions';
import { cn } from '@/lib/utils';

const ICONS: Record<ClockActionIcon, typeof Play> = {
  work: BriefcaseBusiness,
  travel: Route,
  break: Coffee,
  resume: Play,
  job: ArrowLeftRight,
  end: Square,
  more: SlidersHorizontal,
};

/** One button per next action; the first real action is the primary one. */
export function ClockActionButtons({
  actions,
  busy,
  pendingId,
  onActivate,
}: {
  actions: ClockAction[];
  busy: boolean;
  pendingId: string | null;
  onActivate: (action: ClockAction) => void;
}) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Nächste Aktion">
      {actions.map((action, index) => {
        const Icon = ICONS[action.icon];
        const isPrimary = index === 0 && action.kind !== 'more';
        return (
          <Button
            key={action.id}
            type="button"
            variant={isPrimary ? 'default' : action.kind === 'more' ? 'ghost' : 'outline'}
            className={cn(
              'h-auto min-h-12 w-full justify-start gap-3 px-4 text-left text-base whitespace-normal',
              action.kind === 'more' && 'text-muted-foreground',
            )}
            disabled={busy}
            pending={pendingId === action.id}
            onClick={() => onActivate(action)}
          >
            <Icon className="size-5" />
            <span className="min-w-0 flex-1 truncate">{action.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
