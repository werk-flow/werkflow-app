'use client';

import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type DocumentLibraryCategoryFilter,
  type DocumentLibraryLinkFilter,
  type DocumentLibraryView,
} from '@/lib/documents/types';

const categoryFilterOptions: Array<{
  value: DocumentLibraryCategoryFilter;
  label: string;
}> = [
  { value: 'all', label: 'Alle Kategorien' },
  ...Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => ({
    value: value as DocumentCategory,
    label,
  })),
];

const linkFilterOptions: Array<{
  value: DocumentLibraryLinkFilter;
  label: string;
}> = [
  { value: 'all', label: 'Alle Verknüpfungen' },
  { value: 'jobs', label: 'Aufträge' },
  { value: 'projects', label: 'Projekte' },
  { value: 'clients', label: 'Kunden' },
  { value: 'employees', label: 'Mitarbeiter' },
  { value: 'unlinked', label: 'Nicht verknüpft' },
];

type DocumentLibraryFilterPanelProps = {
  visibleView: DocumentLibraryView;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  onCategoryChange: (category: DocumentLibraryCategoryFilter) => void;
  onLinkFilterChange: (linkFilter: DocumentLibraryLinkFilter) => void;
};

/** Category and link filters of the library; they apply in „Alle Dateien" only. */
export function DocumentLibraryFilterPanel({
  visibleView,
  category,
  linkFilter,
  onCategoryChange,
  onLinkFilterChange,
}: DocumentLibraryFilterPanelProps) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kategorie">
          <Select
            value={category}
            onValueChange={(value) => onCategoryChange(value as DocumentLibraryCategoryFilter)}
            disabled={visibleView !== 'all'}
          >
            <SelectTrigger className="h-9 text-sm" aria-label="Kategorie filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryFilterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Verknüpfung">
          <Select
            value={linkFilter}
            onValueChange={(value) => onLinkFilterChange(value as DocumentLibraryLinkFilter)}
            disabled={visibleView !== 'all'}
          >
            <SelectTrigger className="h-9 text-sm" aria-label="Verknüpfung filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {linkFilterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {visibleView !== 'all' && (
        <p className="mt-2 text-xs text-muted-foreground">
          Kategorie- und Verknüpfungsfilter sind in „Alle Dateien“ verfügbar.
        </p>
      )}
    </div>
  );
}
