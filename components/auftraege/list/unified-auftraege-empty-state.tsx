import { Briefcase } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';

type UnifiedAuftraegeEmptyStateProps = {
  /** A search or filter is active, so an empty list means "no match", not "nothing yet". */
  isFiltered: boolean;
  isArchive: boolean;
  isAdminOrManager: boolean;
};

export function UnifiedAuftraegeEmptyState({
  isFiltered,
  isArchive,
  isAdminOrManager,
}: UnifiedAuftraegeEmptyStateProps) {
  return isFiltered ? (
    <EmptyState
      icon={Briefcase}
      title="Keine Einträge gefunden"
      description="Zu Suche und Filtern gibt es keinen Eintrag. Setze die Filter zurück oder ändere die Suche."
    />
  ) : (
    <EmptyState
      icon={Briefcase}
      title={isArchive ? 'Noch nichts archiviert' : 'Noch keine Einträge'}
      description={
        !isAdminOrManager
          ? 'Dir sind noch keine Aufträge zugewiesen.'
          : isArchive
            ? 'Abgeschlossene Aufträge und Projekte erscheinen hier, sobald du sie archivierst.'
            : 'Lege den ersten Auftrag oder das erste Projekt über „Erstellen“ an.'
      }
    />
  );
}
