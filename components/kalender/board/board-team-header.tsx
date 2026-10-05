'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BoardTeamGroup } from '@/lib/calendar/board-model';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { BOARD_NAME_COLUMN_PX } from './types';

type BoardTeamHeaderProps = {
  group: BoardTeamGroup;
  collapsed: boolean;
  setCollapsedTeams: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
};

/** A team's header row on the Plantafel: name, row count and the collapse toggle. */
export function BoardTeamHeader({
  group,
  collapsed,
  setCollapsedTeams,
}: BoardTeamHeaderProps): React.JSX.Element {
  return (
    <div role="row" className="grid" style={{ gridTemplateColumns: `${BOARD_NAME_COLUMN_PX}px 1fr` }}>
      {/* The cell carries the grid role so the toggle keeps its button semantics. */}
      <div role="rowheader" className={cn('sticky left-0', CALENDAR_LAYER_CLASS.sticky)}>
        <PlainButton
          type="button"
          aria-expanded={!collapsed}
          className="flex h-7 w-full items-center gap-1 border-b border-r border-calendar-grid-strong bg-calendar-gutter px-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() =>
            setCollapsedTeams((previous) => {
              const next = new Set(previous);
              if (next.has(group.key)) next.delete(group.key);
              else next.add(group.key);
              return next;
            })
          }
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          )}
          <span className="truncate">{group.name}</span>
          <span className="ml-auto tabular-nums">{group.rows.length}</span>
        </PlainButton>
      </div>
      <div className="border-b border-calendar-grid bg-calendar-gutter" aria-hidden="true" />
    </div>
  );
}
