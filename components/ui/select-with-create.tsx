'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/components/ui/searchable-select';

/**
 * Entity select with an inline „Neu erstellen" action (component registry in
 * the werkflow-design skill). Owns the optimistic merge: an item created in
 * the dialog appears in the list and becomes the selection immediately, before
 * any server-driven list refresh. Domain wrappers (ClientSelectWithCreate,
 * LocationSelectWithCreate, the M5 supplier select) supply labels and the
 * create dialog.
 */
type SelectWithCreateProps<T> = {
  id?: string;
  items: T[];
  /** Maps a domain item to its option; `value` doubles as the item identity. */
  getOption: (item: T) => SearchableSelectOption;
  value: string;
  onValueChange: (value: string) => void;
  createLabel: string;
  renderCreateDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (item: T) => void;
  }) => ReactNode;
  onCreated?: (item: T) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
  readOnly?: boolean;
  readOnlyLabel?: string;
};

export function SelectWithCreate<T>({
  id,
  items,
  getOption,
  value,
  onValueChange,
  createLabel,
  renderCreateDialog,
  onCreated,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  allowNone,
  noneLabel,
  readOnly,
  readOnlyLabel,
}: SelectWithCreateProps<T>) {
  const [createOpen, setCreateOpen] = useState(false);
  const [localItems, setLocalItems] = useState<T[]>([]);

  const mergedItems = useMemo(() => {
    const merged = [...items];
    for (const item of localItems) {
      const itemId = getOption(item).value;
      if (!merged.some((existing) => getOption(existing).value === itemId)) {
        merged.push(item);
      }
    }
    return merged;
  }, [items, localItems, getOption]);

  const options = useMemo(
    () => mergedItems.map(getOption),
    [mergedItems, getOption]
  );

  function handleCreated(item: T) {
    setLocalItems((current) => [...current, item]);
    onValueChange(getOption(item).value);
    onCreated?.(item);
  }

  return (
    <>
      <SearchableSelect
        id={id}
        options={options}
        value={value}
        onChange={onValueChange}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        disabled={disabled}
        allowNone={allowNone}
        noneLabel={noneLabel}
        readOnly={readOnly}
        readOnlyLabel={readOnlyLabel}
        action={
          readOnly
            ? undefined
            : {
                label: createLabel,
                icon: <Plus className="size-4" />,
                onClick: () => setCreateOpen(true),
              }
        }
      />

      {renderCreateDialog({
        open: createOpen,
        onOpenChange: setCreateOpen,
        onCreated: handleCreated,
      })}
    </>
  );
}
