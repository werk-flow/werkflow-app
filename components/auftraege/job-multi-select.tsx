'use client';

import { useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import type { Job } from '@/lib/jobs/types';
import { cn } from '@/lib/utils';

interface JobMultiSelectProps {
  jobs: Job[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function JobMultiSelect({
  jobs,
  selectedIds,
  onSelectionChange,
  disabled = false
}: JobMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggleJob = (jobId: string) => {
    if (selectedIds.includes(jobId)) {
      onSelectionChange(selectedIds.filter((id) => id !== jobId));
    } else {
      onSelectionChange([...selectedIds, jobId]);
    }
  };

  const label =
    selectedIds.length === 0
      ? 'Aufträge zuweisen'
      : selectedIds.length === 1
        ? '1 Auftrag'
        : `${selectedIds.length} Aufträge`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            selectedIds.length === 0 && 'text-muted-foreground'
          )}
        >
          {label}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="max-h-60 overflow-auto p-1">
          {jobs.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Keine verfügbaren Aufträge
            </p>
          ) : (
            jobs.map((job) => {
              const isSelected = selectedIds.includes(job.id);
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => toggleJob(job.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Checkbox
                    checked={isSelected}
                    tabIndex={-1}
                    className="pointer-events-none shrink-0"
                  />
                  <span className="truncate">
                    {job.jobNumber && (
                      <span className="font-mono text-[10px] text-muted-foreground mr-1.5">
                        {job.jobNumber}
                      </span>
                    )}
                    {job.title}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
