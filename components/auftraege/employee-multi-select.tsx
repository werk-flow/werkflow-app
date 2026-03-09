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
import { cn } from '@/lib/utils';

export type OrgMemberOption = {
  userId: string;
  firstName: string;
  lastName: string;
};

interface EmployeeMultiSelectProps {
  members: OrgMemberOption[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
}

function getMemberName(m: OrgMemberOption): string {
  const name = `${m.firstName} ${m.lastName}`.trim();
  return name || 'Unbenannt';
}

export function EmployeeMultiSelect({
  members,
  selectedIds,
  onSelectionChange,
  disabled = false
}: EmployeeMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggleMember = (userId: string) => {
    if (selectedIds.includes(userId)) {
      onSelectionChange(selectedIds.filter((id) => id !== userId));
    } else {
      onSelectionChange([...selectedIds, userId]);
    }
  };

  const label =
    selectedIds.length === 0
      ? 'Mitarbeiter zuweisen'
      : selectedIds.length === 1
        ? '1 Mitarbeiter'
        : `${selectedIds.length} Mitarbeiter`;

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
          {members.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Keine Mitarbeiter verfügbar
            </p>
          ) : (
            members.map((member) => {
              const isSelected = selectedIds.includes(member.userId);
              return (
                <button
                  key={member.userId}
                  type="button"
                  onClick={() => toggleMember(member.userId)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Checkbox
                    checked={isSelected}
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                  <span className="truncate">{getMemberName(member)}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
