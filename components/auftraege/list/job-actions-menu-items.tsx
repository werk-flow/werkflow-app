import { ExternalLink, Trash2, Pencil } from 'lucide-react';

import type { RowActionMenuItem } from '@/components/ui/row-actions-menu';

/** Details, Bearbeiten and Löschen of a job or project row. */
export function rowMenuActions({
  openDetails,
  openEdit,
  openDelete,
}: {
  openDetails: () => void;
  openEdit: () => void;
  openDelete: () => void;
}): RowActionMenuItem[] {
  return [
    {
      label: 'Details anzeigen',
      icon: <ExternalLink className="size-4" />,
      onSelect: openDetails,
    },
    {
      label: 'Bearbeiten',
      icon: <Pencil className="size-4" />,
      onSelect: openEdit,
    },
    {
      label: 'Löschen',
      icon: <Trash2 className="size-4" />,
      onSelect: openDelete,
      variant: 'destructive',
      separatorBefore: true,
    },
  ];
}
