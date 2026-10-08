'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { InventoryCategory, InventoryLocation } from '@/lib/inventory/types';
import { IMPORT_COLUMNS } from '@/lib/inventory/csv-import';
import { useInventoryCsvImport } from './use-inventory-csv-import';

export function ImportDialog({
  open,
  onOpenChange,
  existingItemCount,
  locations,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingItemCount: number;
  locations: InventoryLocation[];
  categories: InventoryCategory[];
}) {
  const {
    headers,
    rows,
    mapping,
    setMapping,
    error,
    isPending,
    fileError,
    nameMappingError,
    setAttempted,
    handleOpenChange,
    handleFile,
    handleImport,
  } = useInventoryCsvImport({ onOpenChange });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isPending}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>CSV importieren</DialogTitle>
          <DialogDescription>
            {rows.length > 0
              ? `${rows.length} Zeilen erkannt`
              : `${existingItemCount} bestehende Artikel, ${locations.length} Lager, ${categories.length} Kategorien`}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (rows.length === 0) {
              document.getElementById('inventory-import-file')?.focus();
              return;
            }
            if (!mapping.name) {
              document.getElementById('inventory-import-name')?.focus();
              return;
            }
            handleImport();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="space-y-4 py-1">
            <Field label="CSV-Datei" htmlFor="inventory-import-file" required error={fileError}>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
              />
            </Field>

            {headers.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {IMPORT_COLUMNS.map((column) => (
                  <Field
                    key={column.key}
                    label={column.label}
                    htmlFor={`inventory-import-${column.key}`}
                    required={column.key === 'name'}
                    error={column.key === 'name' ? nameMappingError : undefined}
                  >
                    <SearchableSelect
                      options={headers.map((header) => ({ value: header, label: header }))}
                      value={mapping[column.key] ?? ''}
                      onChange={(value) =>
                        setMapping({
                          ...mapping,
                          [column.key]: value || undefined,
                        })
                      }
                      placeholder="Nicht importieren"
                      searchPlaceholder="Spalte suchen …"
                      emptyMessage="Keine Spalte gefunden"
                      allowNone
                      noneLabel="Nicht importieren"
                    />
                  </Field>
                ))}
              </div>
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              Importieren
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
