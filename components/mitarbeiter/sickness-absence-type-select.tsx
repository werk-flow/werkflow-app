'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SICKNESS_TYPE_LABELS, type SicknessAbsenceType } from '@/lib/sickness/types';

function isSicknessAbsenceType(value: string): value is SicknessAbsenceType {
  return Object.hasOwn(SICKNESS_TYPE_LABELS, value);
}

type SicknessAbsenceTypeSelectProps = {
  value: SicknessAbsenceType;
  onChange: (value: SicknessAbsenceType) => void;
  disabled: boolean;
};

/** The „Art“ select of the office's sickness dialogs, over the neutral absence-type labels. */
export function SicknessAbsenceTypeSelect({ value, onChange, disabled }: SicknessAbsenceTypeSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isSicknessAbsenceType(next)) onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label="Art">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(SICKNESS_TYPE_LABELS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
