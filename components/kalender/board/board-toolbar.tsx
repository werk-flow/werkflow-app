'use client';

import { CircleHelp, Filter, Rows3, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { CALENDAR_DISPATCH_STATE_LABELS } from '@/lib/calendar/board';
import { CALENDAR_DISPATCH_FILTERS, CALENDAR_HORIZON_WEEKS, type CalendarHorizonWeeks, type CalendarPreferences } from '@/lib/calendar/preferences';
import { cn } from '@/lib/utils';

export type BoardToolbarProps = {
  preferences: CalendarPreferences;
  onChange: (update: Partial<CalendarPreferences>) => void;
  teams: ReadonlyArray<{ id: string; name: string }>;
  showActualTime: boolean;
  onHelp: () => void;
};

/**
 * The board's own controls (P1-24a): horizon, density, the search, and a
 * filter popover for teams, dispatch states, conflicts,
 * weekends and actual time. Every value is a per-user preference.
 */
export function BoardToolbar({ preferences, onChange, teams, showActualTime, onHelp }: BoardToolbarProps): React.JSX.Element {
  const activeFilters = preferences.teamIds.length + preferences.dispatchStates.length + (preferences.onlyConflicts ? 1 : 0);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Plantafel-Einstellungen">
      <Select value={String(preferences.horizonWeeks)} onValueChange={(value) => onChange({ horizonWeeks: Number(value) as CalendarHorizonWeeks })}>
        <SelectTrigger className="h-9 w-[7.5rem]" aria-label="Horizont">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CALENDAR_HORIZON_WEEKS.map((weeks) => (
            <SelectItem key={weeks} value={String(weeks)}>{weeks === 1 ? '1 Woche' : `${weeks} Wochen`}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={preferences.search}
          onChange={(event) => onChange({ search: event.target.value })}
          placeholder="Suchen …"
          aria-label="Plantafel durchsuchen"
          className="h-9 w-40 pl-8 sm:w-52"
        />
      </label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2" aria-label={`Filter${activeFilters ? `, ${activeFilters} aktiv` : ''}`}>
            <Filter className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Filter</span>
            {activeFilters > 0 && <span className="rounded-full bg-primary-foreground px-1.5 text-[11px] text-primary">{activeFilters}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-4">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Team</span>
            <SearchableMultiSelect
              options={teams.map((team) => ({ value: team.id, label: team.name }))}
              selectedIds={preferences.teamIds}
              onSelectionChange={(teamIds) => onChange({ teamIds })}
              placeholder="Alle Teams"
              ariaLabel="Teams filtern"
              allowNone
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Einsatzstatus</legend>
            {CALENDAR_DISPATCH_FILTERS.map((state) => (
              <label key={state} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={preferences.dispatchStates.includes(state)}
                  onCheckedChange={(checked) => onChange({ dispatchStates: checked ? [...preferences.dispatchStates, state] : preferences.dispatchStates.filter((entry) => entry !== state) })}
                />
                {CALENDAR_DISPATCH_STATE_LABELS[state]}
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Anzeige</legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={preferences.onlyConflicts} onCheckedChange={(checked) => onChange({ onlyConflicts: checked === true })} />
              Nur Konflikte
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={preferences.hideWeekends} onCheckedChange={(checked) => onChange({ hideWeekends: checked === true })} />
              Wochenende ausblenden
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={showActualTime} onCheckedChange={(checked) => onChange({ showActualTime: checked === true })} />
              Ist-Zeiten anzeigen
            </label>
          </fieldset>
        </PopoverContent>
      </Popover>
      <Button
        variant="outline"
        size="sm"
        className={cn('h-9 gap-2', preferences.density === 'compact' && 'bg-accent')}
        aria-pressed={preferences.density === 'compact'}
        onClick={() => onChange({ density: preferences.density === 'compact' ? 'comfortable' : 'compact' })}
        aria-label={preferences.density === 'compact' ? 'Komfortabel anzeigen' : 'Kompakt anzeigen'}
        title={preferences.density === 'compact' ? 'Komfortabel anzeigen' : 'Kompakt anzeigen'}
      >
        <Rows3 className="size-4" aria-hidden="true" />
        <span className="hidden lg:inline">{preferences.density === 'compact' ? 'Kompakt' : 'Komfortabel'}</span>
      </Button>
      <Button variant="ghost" size="icon-sm" className="h-9" aria-label="Tastenkürzel anzeigen" onClick={onHelp}>
        <CircleHelp className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
