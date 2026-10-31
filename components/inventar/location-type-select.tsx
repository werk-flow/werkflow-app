'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  INVENTORY_LOCATION_TYPE_LABELS,
  INVENTORY_LOCATION_TYPES,
  type InventoryLocationType,
} from '@/lib/inventory/types';

/** The Lager type picker of both location dialogs; it takes its id from the enclosing `Field`. */
export function LocationTypeSelect({
  value,
  onValueChange,
}: {
  value: InventoryLocationType;
  onValueChange: (locationType: InventoryLocationType) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(selected) => {
        const locationType = INVENTORY_LOCATION_TYPES.find((type) => type === selected);
        if (locationType) onValueChange(locationType);
      }}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(INVENTORY_LOCATION_TYPE_LABELS).map(([type, label]) => (
          <SelectItem key={type} value={type}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
