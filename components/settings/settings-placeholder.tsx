import { SlidersHorizontal } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';

/**
 * A settings area without options yet. The settings shell already shows the
 * area's title and description, so this says only that there is nothing to
 * set, in the same words as every other empty region.
 */
export function SettingsPlaceholder() {
  return (
    <EmptyState
      icon={SlidersHorizontal}
      title="Noch keine Einstellungen"
      description="Für diesen Bereich gibt es noch nichts einzustellen. Sobald es Einstellungen gibt, findest du sie hier."
      className="rounded-lg border bg-card shadow-xs"
    />
  );
}
