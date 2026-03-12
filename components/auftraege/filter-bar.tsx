'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, SlidersHorizontal, X, ChevronsUpDown } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { Client } from '@/lib/jobs/types';
import {
  EMPTY_FILTER_STATE,
  countActiveFilters,
  type FilterState,
  type EntryTypeFilter,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from './employee-multi-select';
import { cn, toLocalDateString } from '@/lib/utils';

function MultiSelectPopover({
  label,
  placeholder,
  selectedIds,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  selectedIds: string[];
  options: { id: string; label: string }[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(selectedIds);

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const displayText = selectedIds.length === 0
    ? placeholder
    : selectedIds.length === 1
      ? options.find((o) => o.id === selectedIds[0])?.label ?? '1 ausgewählt'
      : `${selectedIds.length} ausgewählt`;

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'h-8 w-full justify-between text-xs font-normal',
              selectedIds.length === 0 && 'text-muted-foreground'
            )}
          >
            <span className="truncate">{displayText}</span>
            <ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
          <div className="max-h-48 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Keine Einträge</p>
            ) : (
              options.map((opt) => (
                <div
                  key={opt.id}
                  role="option"
                  aria-selected={selectedSet.has(opt.id)}
                  onClick={() => toggle(opt.id)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                >
                  <Checkbox
                    checked={selectedSet.has(opt.id)}
                    onCheckedChange={() => toggle(opt.id)}
                    className="pointer-events-none size-3.5"
                  />
                  <span className="truncate">{opt.label}</span>
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  clients: Client[];
  members: OrgMemberOption[];
  /** When set, the employee filter shows a locked, read-only field with this label instead of a selectable popover. */
  lockedEmployeeLabel?: string;
  /** When set, the client filter shows a locked, read-only field with this label instead of a selectable popover. */
  lockedClientLabel?: string;
}

export function FilterBar({
  searchQuery,
  onSearchChange,
  filters,
  onFiltersChange,
  clients,
  members,
  lockedEmployeeLabel,
  lockedClientLabel,
}: FilterBarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const handleSearchInput = (value: string) => {
    setLocalSearch(value);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchChange(value);
    }, 300);
  };

  const activeCount = countActiveFilters(filters);

  const handleFilterToggle = () => {
    if (window.innerWidth < 768) {
      setSheetOpen(true);
    } else {
      setPanelOpen((v) => !v);
    }
  };

  const clearAllFilters = () => {
    onFiltersChange(EMPTY_FILTER_STATE);
  };

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clientOptions = clients.map((c) => ({ id: c.id, label: c.name }));
  const memberOptions = members.map((m) => ({ id: m.userId, label: `${m.firstName} ${m.lastName}` }));

  const filterFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      {lockedClientLabel ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">Kunde</Label>
          <div className="flex h-8 w-full items-center rounded-md border bg-muted px-3 text-xs cursor-not-allowed text-muted-foreground">
            <span className="truncate">{lockedClientLabel}</span>
          </div>
        </div>
      ) : (
        <MultiSelectPopover
          label="Kunde"
          placeholder="Alle Kunden"
          selectedIds={filters.clientIds}
          options={clientOptions}
          onChange={(ids) => updateFilter('clientIds', ids)}
        />
      )}

      {lockedEmployeeLabel ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">Mitarbeiter</Label>
          <div className="flex h-8 w-full items-center rounded-md border bg-muted px-3 text-xs cursor-not-allowed text-muted-foreground">
            <span className="truncate">{lockedEmployeeLabel}</span>
          </div>
        </div>
      ) : (
        <MultiSelectPopover
          label="Mitarbeiter"
          placeholder="Alle Mitarbeiter"
          selectedIds={filters.employeeIds}
          options={memberOptions}
          onChange={(ids) => updateFilter('employeeIds', ids)}
        />
      )}

      <div className="grid gap-1.5">
        <Label className="text-xs">Datum von</Label>
        <DatePicker
          value={filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00') : undefined}
          onChange={(d) => updateFilter('dateFrom', d ? toLocalDateString(d) : '')}
          placeholder="Von"
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Datum bis</Label>
        <DatePicker
          value={filters.dateTo ? new Date(filters.dateTo + 'T00:00:00') : undefined}
          onChange={(d) => updateFilter('dateTo', d ? toLocalDateString(d) : '')}
          placeholder="Bis"
        />
      </div>

      <div className="grid gap-1.5 sm:col-span-2">
        <Label className="text-xs">Typ</Label>
        <Select
          value={filters.entryType}
          onValueChange={(v) => updateFilter('entryType', v as EntryTypeFilter)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle</SelectItem>
            <SelectItem value="jobs">Nur Aufträge</SelectItem>
            <SelectItem value="projekte">Nur Projekte</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const clientChipLabel = filters.clientIds.length === 1
    ? clients.find((c) => c.id === filters.clientIds[0])?.name ?? '1 Kunde'
    : `${filters.clientIds.length} Kunden`;

  const employeeChipLabel = filters.employeeIds.length === 1
    ? (() => { const m = members.find((m) => m.userId === filters.employeeIds[0]); return m ? `${m.firstName} ${m.lastName}` : '1 Mitarbeiter'; })()
    : `${filters.employeeIds.length} Mitarbeiter`;

  const activeChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.clientIds.length > 0 && (
        <Badge variant="secondary" className="gap-1 text-xs">
          Kunde: {clientChipLabel}
          <button onClick={() => updateFilter('clientIds', [])} className="ml-0.5 hover:text-destructive">
            <X className="size-3" />
          </button>
        </Badge>
      )}
      {filters.employeeIds.length > 0 && (
        <Badge variant="secondary" className="gap-1 text-xs">
          Mitarbeiter: {employeeChipLabel}
          <button onClick={() => updateFilter('employeeIds', [])} className="ml-0.5 hover:text-destructive">
            <X className="size-3" />
          </button>
        </Badge>
      )}
      {(filters.dateFrom || filters.dateTo) && (
        <Badge variant="secondary" className="gap-1 text-xs">
          Zeitraum: {filters.dateFrom || '...'} – {filters.dateTo || '...'}
          <button onClick={() => { updateFilter('dateFrom', ''); updateFilter('dateTo', ''); }} className="ml-0.5 hover:text-destructive">
            <X className="size-3" />
          </button>
        </Badge>
      )}
      {filters.entryType !== 'alle' && (
        <Badge variant="secondary" className="gap-1 text-xs">
          {filters.entryType === 'jobs' ? 'Nur Aufträge' : 'Nur Projekte'}
          <button onClick={() => updateFilter('entryType', 'alle')} className="ml-0.5 hover:text-destructive">
            <X className="size-3" />
          </button>
        </Badge>
      )}
      <button
        onClick={clearAllFilters}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Alle zurücksetzen
      </button>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Suche nach Bezeichnung, Nummer, Kunde, Ort..."
            value={localSearch}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="h-9 pl-9 text-sm"
          />
          {localSearch && (
            <button
              onClick={() => { setLocalSearch(''); onSearchChange(''); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button
          variant={activeCount > 0 ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5 shrink-0"
          onClick={handleFilterToggle}
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">Filter</span>
          {activeCount > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary-foreground text-[10px] font-bold text-primary">
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      {/* Desktop filter panel */}
      {panelOpen && (
        <div className="hidden rounded-lg border bg-card p-3 md:block">
          {filterFields}
        </div>
      )}

      {/* Mobile filter sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-xl pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle>Filter</SheetTitle>
            <SheetDescription>Filtere Aufträge und Projekte</SheetDescription>
          </SheetHeader>
          {filterFields}
        </SheetContent>
      </Sheet>

      {activeCount > 0 && activeChips}
    </div>
  );
}
