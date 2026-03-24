'use client';

import { useState } from 'react';
import { Filter, Check, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { CalendarView, CalendarFilters } from './calendar-container';

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface CalendarViewTabsProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  members: CalendarMember[];
  selectedMembers: string[];
  onSelectedMembersChange: (members: string[]) => void;
  isAdminOrManager: boolean;
  filters: CalendarFilters;
  onFiltersChange: (filters: CalendarFilters) => void;
}

function getMemberDisplayName(member: CalendarMember): string {
  if (member.first_name || member.last_name) {
    return `${member.first_name || ''} ${member.last_name || ''}`.trim();
  }
  return member.email;
}

export function CalendarViewTabs({
  view,
  onViewChange,
  members,
  selectedMembers,
  onSelectedMembersChange,
  isAdminOrManager,
  filters,
  onFiltersChange
}: CalendarViewTabsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isMemberFilterOpen, setIsMemberFilterOpen] = useState(false);

  const filteredMembers = members.filter((member) => {
    const name = getMemberDisplayName(member).toLowerCase();
    const email = member.email.toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const handleToggleMember = (userId: string) => {
    if (selectedMembers.includes(userId)) {
      onSelectedMembersChange(selectedMembers.filter((id) => id !== userId));
    } else {
      onSelectedMembersChange([...selectedMembers, userId]);
    }
  };

  const handleSelectAll = () => {
    onSelectedMembersChange(members.map((m) => m.user_id));
  };

  const handleSelectNone = () => {
    onSelectedMembersChange([]);
  };

  const handleMemberFilterOpenChange = (open: boolean) => {
    setIsMemberFilterOpen(open);

    if (!open) {
      setSearchQuery('');
    }
  };

  const handleToggleWorkingHours = () => {
    onFiltersChange({
      ...filters,
      showWorkingHours: !filters.showWorkingHours
    });
  };

  const handleToggleJobs = () => {
    onFiltersChange({
      ...filters,
      showJobs: !filters.showJobs
    });
  };

  const memberFilterContent = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Mitarbeiter suchen..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8"
        />
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSelectAll}
          className="flex-1 text-xs"
        >
          Alle auswählen
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSelectNone}
          className="flex-1 text-xs"
        >
          Keine auswählen
        </Button>
      </div>

      <div className="max-h-60 overflow-auto">
        {filteredMembers.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">
            Keine Mitarbeiter gefunden
          </p>
        ) : (
          <div className="space-y-1">
            {filteredMembers.map((member) => (
              <button
                key={member.user_id}
                type="button"
                onClick={() => handleToggleMember(member.user_id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  'hover:bg-accent',
                  selectedMembers.includes(member.user_id) && 'bg-accent/50'
                )}
              >
                <div
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-sm border',
                    selectedMembers.includes(member.user_id)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground'
                  )}
                >
                  {selectedMembers.includes(member.user_id) && (
                    <Check className="h-3 w-3" />
                  )}
                </div>
                <span className="flex-1 truncate text-left">
                  {getMemberDisplayName(member)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <Tabs
          value={view}
          onValueChange={(v) => onViewChange(v as CalendarView)}
        >
          <TabsList>
            <TabsTrigger value="day">Tag</TabsTrigger>
            <TabsTrigger value="week">Woche</TabsTrigger>
            <TabsTrigger value="month">Monat</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Event type filters - simple checkbox style */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Anzeigen:</span>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                filters.showWorkingHours
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-muted-foreground/50 bg-background'
              )}
              onClick={handleToggleWorkingHours}
            >
              {filters.showWorkingHours && <Check className="h-3 w-3" />}
            </div>
            <span
              className={cn(
                'transition-colors',
                filters.showWorkingHours
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              )}
              onClick={handleToggleWorkingHours}
            >
              Arbeitszeiten
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                filters.showJobs
                  ? 'border-brand-purple bg-brand-purple text-white'
                  : 'border-muted-foreground/50 bg-background'
              )}
              onClick={handleToggleJobs}
            >
              {filters.showJobs && <Check className="h-3 w-3" />}
            </div>
            <span
              className={cn(
                'transition-colors',
                filters.showJobs
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              )}
              onClick={handleToggleJobs}
            >
              Aufträge
            </span>
          </label>
        </div>
      </div>

      {isAdminOrManager && members.length > 0 && (
        <Popover
          open={isMemberFilterOpen}
          onOpenChange={handleMemberFilterOpenChange}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Mitarbeiter ({selectedMembers.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(20rem,calc(100vw-1rem))] p-3 sm:w-72 sm:p-4"
            align="center"
            side="bottom"
            collisionPadding={8}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            {memberFilterContent}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
