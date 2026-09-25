'use client';

import type { ReactNode } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { CalendarView } from './calendar-container';
import { memberDisplayName, type CalendarMember } from './members';

interface CalendarViewTabsProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  members: CalendarMember[];
  /** null means every member. */
  selectedMemberIds: string[] | null;
  onSelectedMemberIdsChange: (memberIds: string[] | null) => void;
  isAdminOrManager: boolean;
  showWorkingHours: boolean;
  onShowWorkingHoursChange: (value: boolean) => void;
  showJobs: boolean;
  onShowJobsChange: (value: boolean) => void;
  /** The active view's own toolbar (the board's horizon, density and filters). */
  children?: ReactNode;
}

export function CalendarViewTabs({ view, onViewChange, members, selectedMemberIds, onSelectedMemberIdsChange, isAdminOrManager, showWorkingHours, onShowWorkingHoursChange, showJobs, onShowJobsChange, children }: CalendarViewTabsProps) {
  const selectedCount = selectedMemberIds ? selectedMemberIds.length : members.length;
  return (
    // The tabs never give ground: the row wraps, and the active view's toolbar sits on its own row below.
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tabs value={view} onValueChange={(value) => onViewChange(value as CalendarView)} className="shrink-0">
          <TabsList>
            <TabsTrigger value="day">Tag</TabsTrigger>
            <TabsTrigger value="week">{isAdminOrManager ? 'Plantafel' : 'Woche'}</TabsTrigger>
            <TabsTrigger value="month">Monat</TabsTrigger>
          </TabsList>
        </Tabs>

        <div role="group" aria-label="Angezeigte Einträge" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <Checkbox checked={showWorkingHours} onCheckedChange={(checked) => onShowWorkingHoursChange(checked === true)} />
            <span className={cn('transition-colors', showWorkingHours ? 'text-foreground' : 'text-muted-foreground')}>Arbeitszeiten</span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <Checkbox checked={showJobs} onCheckedChange={(checked) => onShowJobsChange(checked === true)} className="data-[state=checked]:border-calendar-planning-strong data-[state=checked]:bg-calendar-planning-strong data-[state=checked]:text-white" />
            <span className={cn('transition-colors', showJobs ? 'text-foreground' : 'text-muted-foreground')}>Termine</span>
          </label>
        </div>

        {isAdminOrManager && members.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto h-9">
              <Filter className="mr-2 size-4" aria-hidden="true" />
              Mitarbeiter ({selectedCount})
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(20rem,calc(100vw-1rem))] space-y-3 p-3 sm:w-80" align="end" collisionPadding={8}>
            <SearchableMultiSelect
              options={members.map((member) => ({ value: member.user_id, label: memberDisplayName(member), description: member.email }))}
              selectedIds={selectedMemberIds ?? members.map((member) => member.user_id)}
              onSelectionChange={(ids) => onSelectedMemberIdsChange(ids.length === members.length ? null : ids)}
              placeholder="Mitarbeiter wählen"
              ariaLabel="Mitarbeiter filtern"
              searchPlaceholder="Mitarbeiter suchen …"
              emptyMessage="Keine Mitarbeiter gefunden"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => onSelectedMemberIdsChange(null)}>Alle auswählen</Button>
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => onSelectedMemberIdsChange([])}>Keine auswählen</Button>
            </div>
          </PopoverContent>
        </Popover>
        )}
      </div>
      {children}
    </div>
  );
}
