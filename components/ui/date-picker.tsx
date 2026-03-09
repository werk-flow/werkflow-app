'use client';

import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import { de } from 'react-day-picker/locale';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';

interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Datum wählen',
  disabled = false
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground'
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          {value
            ? value.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
          locale={de}
        />
      </PopoverContent>
    </Popover>
  );
}
