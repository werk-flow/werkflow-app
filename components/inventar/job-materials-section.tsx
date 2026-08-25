'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import {
  createJobMaterialLine,
  createProjectMaterialLine,
  deleteJobMaterialLine,
  getInventoryPickerOptionsForJob,
  getJobMaterialLines,
  returnJobMaterial,
  takeJobMaterial,
  takeProjectMaterial,
  updateJobMaterialLine,
} from '@/lib/inventory/actions';
import type {
  InventoryLocation,
  InventoryPickerOption,
  JobMaterialLine,
  ProjectMaterialSummary,
} from '@/lib/inventory/types';
import {
  formatInventoryQuantity,
  getInventoryUnitLabel,
  INVENTORY_ITEM_TYPE_LABELS,
  JOB_MATERIAL_STATUS_LABELS,
} from '@/lib/inventory/types';
import { cn } from '@/lib/utils';

type MaterialDialogMode = 'plan' | 'take' | 'return' | 'edit';

type MaterialDialogRow = {
  key: string;
  lineId: string | null;
  itemId: string;
  locationId: string;
  quantity: string;
  notes: string;
  takenQuantity: number;
  returnedQuantity: number;
};

type MaterialDialogState = {
  mode: MaterialDialogMode;
  rows: MaterialDialogRow[];
  search: string;
  error: string | null;
};

type JobMaterialsSectionProps = {
  jobId?: string;
  projectId?: string;
  initialLines: JobMaterialLine[];
  inventoryItems: InventoryPickerOption[];
  locations: InventoryLocation[];
  isAdminOrManager: boolean;
  inheritedJobGroups?: ProjectMaterialSummary['jobGroups'];
  totals?: ProjectMaterialSummary['totals'];
  readOnly?: boolean;
};

const NO_LOCATION_VALUE = '__no_location__';

function decimalFromInput(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityToInput(quantity: number): string {
  return Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toLocaleString('de-DE', {
        maximumFractionDigits: 2,
        useGrouping: false,
      });
}

function statusClasses(status: JobMaterialLine['status']): string {
  switch (status) {
    case 'planned':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300';
    case 'partially_taken':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300';
    case 'taken':
      return 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300';
    case 'returned':
      return 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300';
    case 'cancelled':
      return 'bg-muted text-muted-foreground';
  }
}

function getActionErrorMessage(error: string, mode: MaterialDialogMode): string {
  const messages: Record<string, string> = {
    item_required: 'Bitte wähle mindestens einen Artikel aus.',
    quantity_required: 'Bitte gib eine Menge größer als 0 ein.',
    location_required: 'Bitte wähle ein Lager mit Bestand aus.',
    stock_would_go_negative:
      'Der Bestand in diesem Lager reicht nicht aus. Wähle eine kleinere Menge oder ein anderes Lager.',
    return_exceeds_taken:
      'Du kannst nicht mehr zurücklegen, als für diese Position entnommen wurde.',
    line_has_movements:
      'Der Artikel kann nicht mehr geändert werden, weil für diese Position bereits Entnahmen oder Rückgaben gebucht wurden.',
    item_not_found: 'Der ausgewählte Artikel wurde nicht gefunden.',
    location_not_found: 'Das ausgewählte Lager wurde nicht gefunden.',
    line_not_found: 'Die Materialposition wurde nicht gefunden.',
    line_create_failed: 'Die Materialposition konnte nicht angelegt werden.',
    not_authorized: 'Du hast keine Berechtigung für diese Aktion.',
    create_failed: 'Die Materialposition konnte nicht gespeichert werden.',
    update_failed: 'Die Materialposition konnte nicht aktualisiert werden.',
    delete_failed: 'Die Materialposition konnte nicht entfernt werden.',
  };

  if (messages[error]) return messages[error];

  if (mode === 'take') return 'Die Entnahme konnte nicht gebucht werden.';
  if (mode === 'return') return 'Die Rückgabe konnte nicht gebucht werden.';
  if (mode === 'edit') return 'Die Materialposition konnte nicht geändert werden.';
  return 'Das Material konnte nicht geplant werden.';
}

function matchesItemSearch(item: InventoryPickerOption, search: string): boolean {
  if (!search.trim()) return true;
  const query = search.trim().toLowerCase();
  return [
    item.name,
    item.internalSku,
    item.categoryName,
    item.manufacturer,
    item.supplierName,
    item.supplierArticleNumber,
    item.primaryBarcode,
    INVENTORY_ITEM_TYPE_LABELS[item.itemType],
    ...item.stockByLocation.map((stock) => stock.locationName),
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(query));
}

function getDefaultLocationId(
  item: InventoryPickerOption,
  locations: InventoryLocation[],
  mode: MaterialDialogMode,
  fallbackLocationId?: string | null
): string {
  if (fallbackLocationId) return fallbackLocationId;
  if (mode === 'take') {
    return (
      item.stockByLocation.find((stock) => stock.quantityOnHand > 0)?.locationId ??
      ''
    );
  }
  return item.stockByLocation[0]?.locationId ?? locations[0]?.id ?? '';
}

function getLocationOptions(
  item: InventoryPickerOption | undefined,
  locations: InventoryLocation[],
  mode: MaterialDialogMode
) {
  if (!item) return [];
  if (mode === 'take') {
    return item.stockByLocation
      .filter((stock) => stock.quantityOnHand > 0)
      .map((stock) => ({
        id: stock.locationId,
        label: `${stock.locationName} · ${formatInventoryQuantity(
          stock.quantityOnHand,
          item.unit
        )}`,
      }));
  }

  if (mode === 'plan' || mode === 'edit') {
    const stockLocations = item.stockByLocation.map((stock) => ({
      id: stock.locationId,
      label: `${stock.locationName} · ${formatInventoryQuantity(
        stock.quantityOnHand,
        item.unit
      )}`,
    }));
    return stockLocations.length > 0
      ? stockLocations
      : locations.map((location) => ({ id: location.id, label: location.name }));
  }

  return locations.map((location) => ({ id: location.id, label: location.name }));
}

function buildDialogRow(
  item: InventoryPickerOption,
  locations: InventoryLocation[],
  mode: MaterialDialogMode,
  line?: JobMaterialLine
): MaterialDialogRow {
  const remainingPlanned = line
    ? Math.max(0, line.plannedQuantity - line.takenQuantity)
    : 0;
  const stillOut = line
    ? Math.max(0, line.takenQuantity - line.returnedQuantity)
    : 0;
  const defaultQuantity =
    mode === 'return'
      ? stillOut || 1
      : mode === 'take'
        ? remainingPlanned || 1
        : line?.plannedQuantity || 1;

  return {
    key: line?.id ?? `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    lineId: line?.id ?? null,
    itemId: item.id,
    locationId: getDefaultLocationId(
      item,
      locations,
      mode,
      line?.preferredLocationId
    ),
    quantity: quantityToInput(defaultQuantity),
    notes: line?.notes ?? '',
    takenQuantity: line?.takenQuantity ?? 0,
    returnedQuantity: line?.returnedQuantity ?? 0,
  };
}

function itemFromLine(line: JobMaterialLine): InventoryPickerOption {
  return {
    id: line.itemId,
    itemType: line.itemType,
    name: line.itemName,
    unit: line.unit,
    internalSku: null,
    manufacturer: null,
    supplierName: null,
    supplierArticleNumber: null,
    primaryBarcode: null,
    categoryName: line.categoryName,
    isBillable: line.isBillable,
    availableQuantity: line.availableQuantity,
    stockByLocation: [],
  };
}

function MovementPill({
  tone,
  children,
}: {
  tone: 'planned' | 'take' | 'return';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        tone === 'planned' &&
          'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
        tone === 'take' &&
          'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
        tone === 'return' &&
          'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300'
      )}
    >
      {children}
    </span>
  );
}

export function JobMaterialsSection({
  jobId,
  projectId,
  initialLines,
  inventoryItems,
  locations,
  isAdminOrManager,
  inheritedJobGroups = [],
  totals = [],
  readOnly = false,
}: JobMaterialsSectionProps): ReactElement {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [dialog, setDialog] = useState<MaterialDialogState | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pickerItems, setPickerItems] = useState(inventoryItems);
  const [pickerLocations, setPickerLocations] = useState(locations);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const loadedFieldSearchesRef = useRef(new Set<string>());
  const [isFieldSaving, setIsFieldSaving] = useState(false);
  const [serverBackedFieldLines, setServerBackedFieldLines] = useState(initialLines);
  const isProjectContext = Boolean(projectId && !jobId);
  const displayedLines = isAdminOrManager ? initialLines : serverBackedFieldLines;
  const fieldRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldRefreshGenerationRef = useRef(0);
  const refreshFieldLines = useCallback(async () => {
    if (isAdminOrManager || !jobId) return;
    const generation = ++fieldRefreshGenerationRef.current;
    try {
      const result = await getJobMaterialLines(jobId);
      if (generation !== fieldRefreshGenerationRef.current) return;
      if (result.success) {
        setServerBackedFieldLines(result.lines);
        setSectionError(null);
      } else {
        setSectionError('Der aktuelle Materialstand konnte nicht geladen werden. Die letzten bekannten Angaben bleiben sichtbar.');
      }
    } catch {
      if (generation !== fieldRefreshGenerationRef.current) return;
      setSectionError('Der aktuelle Materialstand konnte nicht geladen werden. Die letzten bekannten Angaben bleiben sichtbar.');
    }
  }, [isAdminOrManager, jobId]);
  const scheduleFieldRefresh = useCallback(() => {
    if (isAdminOrManager || !jobId) return;
    if (fieldRefreshTimerRef.current) clearTimeout(fieldRefreshTimerRef.current);
    fieldRefreshTimerRef.current = setTimeout(() => {
      fieldRefreshTimerRef.current = null;
      void refreshFieldLines();
    }, 150);
  }, [isAdminOrManager, jobId, refreshFieldLines]);
  useRealtimeEvent('job_material_lines', scheduleFieldRefresh);
  useRealtimeEvent('inventory_movements', scheduleFieldRefresh);
  useRealtimeEvent('inventory_stock_levels', scheduleFieldRefresh);
  useEffect(
    () => () => {
      if (fieldRefreshTimerRef.current) clearTimeout(fieldRefreshTimerRef.current);
    },
    []
  );

  async function loadPickerOptions(): Promise<{
    items: InventoryPickerOption[];
    locations: InventoryLocation[];
  } | null> {
    if (isAdminOrManager || !jobId) {
      return { items: pickerItems, locations: pickerLocations };
    }

    setIsPickerLoading(true);
    try {
      loadedFieldSearchesRef.current.clear();
      const result = await getInventoryPickerOptionsForJob(jobId);
      if (!result.success) {
        setSectionError('Material und Lagerorte konnten nicht geladen werden. Bitte versuche es erneut.');
        return null;
      }
      setPickerItems(result.items);
      setPickerLocations(result.locations);
      loadedFieldSearchesRef.current.add('');
      return result;
    } catch {
      setSectionError('Material und Lagerorte konnten nicht geladen werden. Bitte versuche es erneut.');
      return null;
    } finally {
      setIsPickerLoading(false);
    }
  }

  const fieldSearch = dialog?.search.trim() ?? '';
  const isDialogOpen = dialog !== null;
  useEffect(() => {
    if (isAdminOrManager || !jobId || !isDialogOpen || fieldSearch.length < 2) return;
    const searchKey = fieldSearch.toLocaleLowerCase('de-DE');
    if (loadedFieldSearchesRef.current.has(searchKey)) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsPickerLoading(true);
      try {
        const result = await getInventoryPickerOptionsForJob(jobId, fieldSearch);
        if (cancelled) return;
        if (!result.success) {
          setDialog((current) => current
            ? { ...current, error: 'Die Artikelsuche ist fehlgeschlagen. Bitte versuche es erneut.' }
            : current);
          return;
        }
        loadedFieldSearchesRef.current.add(searchKey);
        setPickerItems((current) => {
          const merged = new Map(current.map((item) => [item.id, item]));
          for (const item of result.items) merged.set(item.id, item);
          return Array.from(merged.values());
        });
        setPickerLocations(result.locations);
      } catch {
        if (!cancelled) {
          setDialog((current) => current
            ? { ...current, error: 'Die Artikelsuche ist fehlgeschlagen. Bitte versuche es erneut.' }
            : current);
        }
      } finally {
        if (!cancelled) setIsPickerLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setIsPickerLoading(false);
    };
  }, [fieldSearch, isAdminOrManager, isDialogOpen, jobId]);

  async function openDialog(mode: MaterialDialogMode, line?: JobMaterialLine) {
    setSectionError(null);
    const picker = await loadPickerOptions();
    if (!picker) return;

    if (line) {
      let item = picker.items.find((entry) => entry.id === line.itemId);
      if (!item && jobId && !isAdminOrManager) {
        const targeted = await getInventoryPickerOptionsForJob(jobId, '', line.itemId);
        if (targeted.success) {
          const targetedItem = targeted.items[0];
          if (targetedItem) {
            item = targetedItem;
            setPickerItems((current) => [
              ...current.filter((entry) => entry.id !== targetedItem.id),
              targetedItem,
            ]);
          }
        }
      }
      item ??= mode === 'return' || mode === 'edit' ? itemFromLine(line) : undefined;
      if (!item) {
        setSectionError('Der Artikel zu dieser Materialposition wurde nicht gefunden.');
        return;
      }
      setDialog({
        mode,
        rows: [buildDialogRow(item, picker.locations, mode, line)],
        search: '',
        error: null,
      });
      return;
    }

    setDialog({
      mode,
      rows: [],
      search: '',
      error: null,
    });
  }

  function updateDialogError(error: string, mode: MaterialDialogMode) {
    setDialog((current) =>
      current
        ? { ...current, error: getActionErrorMessage(error, mode) }
        : current
    );
  }

  function handleDialogSave() {
    if (!dialog) return;

    setDialog({ ...dialog, error: null });
    if (!isAdminOrManager) setIsFieldSaving(true);
    startTransition(async () => {
      if (dialog.rows.length === 0) {
        setIsFieldSaving(false);
        updateDialogError('item_required', dialog.mode);
        return;
      }

      const validatedRows: Array<{ row: MaterialDialogRow; quantity: number }> = [];

      for (const row of dialog.rows) {
        const quantity = decimalFromInput(row.quantity);
        if (!row.itemId) {
          setIsFieldSaving(false);
          updateDialogError('item_required', dialog.mode);
          return;
        }
        if (quantity <= 0) {
          setIsFieldSaving(false);
          updateDialogError('quantity_required', dialog.mode);
          return;
        }
        if ((dialog.mode === 'take' || dialog.mode === 'return') && !row.locationId) {
          setIsFieldSaving(false);
          updateDialogError('location_required', dialog.mode);
          return;
        }

        validatedRows.push({ row, quantity });
      }

      for (const [rowIndex, { row, quantity }] of validatedRows.entries()) {
        const preferredLocationId =
          row.locationId && row.locationId !== NO_LOCATION_VALUE
            ? row.locationId
            : null;

        let result: { success: true } | { success: false; error: string };
        try {
          result = dialog.mode === 'plan' && jobId
            ? await createJobMaterialLine({
                jobId,
                itemId: row.itemId,
                preferredLocationId,
                plannedQuantity: quantity,
                notes: row.notes,
              })
            : dialog.mode === 'plan' && projectId
              ? await createProjectMaterialLine({
                  projectId,
                  itemId: row.itemId,
                  preferredLocationId,
                  plannedQuantity: quantity,
                  notes: row.notes,
                })
              : dialog.mode === 'take' && jobId
                ? await takeJobMaterial({
                    jobId,
                    lineId: row.lineId,
                    itemId: row.itemId,
                    locationId: row.locationId,
                    quantity,
                    reason: row.notes,
                  })
                : dialog.mode === 'take' && projectId
                  ? await takeProjectMaterial({
                      projectId,
                      lineId: row.lineId,
                      itemId: row.itemId,
                      locationId: row.locationId,
                      quantity,
                      reason: row.notes,
                    })
                  : dialog.mode === 'return'
                    ? await returnJobMaterial({
                        lineId: row.lineId ?? '',
                        locationId: row.locationId,
                        quantity,
                        reason: row.notes,
                      })
                    : await updateJobMaterialLine({
                        lineId: row.lineId ?? '',
                        itemId: row.itemId,
                        preferredLocationId,
                        plannedQuantity: quantity,
                        notes: row.notes,
                      });
        } catch {
          result = { success: false, error: 'unexpected_error' };
        }

        if (!result.success) {
          setIsFieldSaving(false);
          setDialog((current) =>
            current
              ? {
                  ...current,
                  rows: dialog.rows.slice(rowIndex),
                  error: getActionErrorMessage(result.error, dialog.mode),
                }
              : current
          );
          return;
        }

      }

      if (!isAdminOrManager && jobId) {
        try {
          const refreshedLines = await getJobMaterialLines(jobId);
          if (refreshedLines.success) {
            setServerBackedFieldLines(refreshedLines.lines);
          } else {
            setSectionError('Die Buchung wurde gespeichert, aber der aktuelle Materialstand konnte nicht geladen werden.');
          }
        } catch {
          setSectionError('Die Buchung wurde gespeichert, aber der aktuelle Materialstand konnte nicht geladen werden.');
        }
      }

      setIsFieldSaving(false);
      setDialog(null);
      showBanner({
        variant: 'success',
        message:
          dialog.mode === 'take'
            ? 'Die Entnahme wurde gebucht.'
            : dialog.mode === 'return'
              ? 'Das Material wurde zurückgelegt.'
              : 'Die Materialplanung wurde gespeichert.',
      });
      if (isAdminOrManager) {
        router.refresh();
      }
    });
  }

  function handleDelete(lineId: string) {
    setSectionError(null);
    startTransition(async () => {
      const result = await deleteJobMaterialLine(lineId);
      if (!result.success) {
        setSectionError(getActionErrorMessage(result.error, 'edit'));
        return;
      }
      showBanner({
        variant: 'success',
        message: 'Die Materialposition wurde entfernt.',
      });
      router.refresh();
    });
  }

  const hasDirectLines = displayedLines.length > 0;
  const hasInheritedLines = inheritedJobGroups.length > 0;

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <ClipboardList className="size-4" />
            Material &amp; Inventar
          </h3>
          {isProjectContext && totals.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.length} zusammengefasste Artikel aus Projekt und Aufträgen
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdminOrManager && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => void openDialog('plan')}
              disabled={inventoryItems.length === 0}
            >
              <Plus className="size-3.5" />
              Material planen
            </Button>
          )}
          {!readOnly && <Button
            variant="ghost"
            size="sm"
            className={cn('gap-1 text-xs', isAdminOrManager ? 'h-8' : 'min-h-11')}
            onClick={() => void openDialog('take')}
            aria-busy={isPickerLoading || isFieldSaving}
            disabled={
              isPickerLoading ||
              isFieldSaving ||
              (isAdminOrManager && inventoryItems.length === 0)
            }
          >
            {isPickerLoading
              ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              : <PackagePlus className="size-3.5" aria-hidden="true" />}
            {isPickerLoading ? 'Material wird geladen…' : 'Aus Lager entnehmen'}
          </Button>}
        </div>
      </div>

      {!hasDirectLines ? (
        <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-medium">
            {isProjectContext
              ? 'Noch kein direktes Projektmaterial erfasst.'
              : 'Noch kein Material erfasst.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Planen speichert nur den Bedarf. Entnehmen bucht die tatsächliche
            Bewegung im Lager.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedLines.map((line) => (
            <MaterialLineRow
              key={line.id}
              line={line}
              isAdminOrManager={isAdminOrManager}
              isPending={isAdminOrManager ? isPending : isPickerLoading || isFieldSaving}
              locations={pickerLocations}
              readOnly={readOnly}
              onTake={() => void openDialog('take', line)}
              onReturn={() => void openDialog('return', line)}
              onEdit={() => void openDialog('edit', line)}
              onDelete={() => handleDelete(line.id)}
            />
          ))}
        </div>
      )}

      {hasInheritedLines && (
        <div className="mt-5 space-y-3 border-t pt-4">
          <div>
            <h4 className="text-sm font-semibold">Aus Aufträgen übernommen</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Diese Positionen gehören zu Aufträgen innerhalb dieses Projekts.
            </p>
          </div>
          {inheritedJobGroups.map((group) => (
            <div key={group.jobId} className="rounded-md border bg-background/70 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {group.jobNumber ? `Auftrag ${group.jobNumber}` : 'Auftrag'}
                </Badge>
                <span className="text-sm font-medium">{group.jobTitle}</span>
              </div>
              <div className="space-y-2">
                {group.lines.map((line) => (
                  <MaterialLineRow
                    key={line.id}
                    line={line}
                    isAdminOrManager={false}
                    showBillableData={isAdminOrManager}
                    isPending={isPending}
                    locations={locations}
                    readOnly
                    onTake={() => undefined}
                    onReturn={() => undefined}
                    onEdit={() => undefined}
                    onDelete={() => undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {isProjectContext && totals.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <h4 className="mb-3 text-sm font-semibold">Projekt gesamt</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {totals.map((total) => (
              <div
                key={`${total.itemId}-${total.unit}`}
                className="rounded-md border bg-background px-3 py-2"
              >
                <p className="truncate text-sm font-medium">{total.itemName}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {total.plannedQuantity > 0 && (
                    <MovementPill tone="planned">
                      Bedarf {formatInventoryQuantity(total.plannedQuantity, total.unit)}
                    </MovementPill>
                  )}
                  {total.takenQuantity > 0 && (
                    <MovementPill tone="take">
                      -{formatInventoryQuantity(total.takenQuantity, total.unit)}
                    </MovementPill>
                  )}
                  {total.returnedQuantity > 0 && (
                    <MovementPill tone="return">
                      +{formatInventoryQuantity(total.returnedQuantity, total.unit)}
                    </MovementPill>
                  )}
                  {isAdminOrManager && total.billableQuantity > 0 && (
                    <MovementPill tone="planned">
                      Abrechenbar {formatInventoryQuantity(total.billableQuantity, total.unit)}
                    </MovementPill>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ErrorText className="mt-3">{sectionError}</ErrorText>

      <MaterialSelectionDialog
        dialog={dialog}
        setDialog={setDialog}
        items={pickerItems}
        locations={pickerLocations}
        isSaving={isAdminOrManager ? isPending : isFieldSaving}
        isSearching={!isAdminOrManager && isPickerLoading}
        onSave={handleDialogSave}
      />
    </div>
  );
}

function MaterialLineRow({
  line,
  isAdminOrManager,
  showBillableData = isAdminOrManager,
  isPending,
  locations,
  readOnly = false,
  onTake,
  onReturn,
  onEdit,
  onDelete,
}: {
  line: JobMaterialLine;
  isAdminOrManager: boolean;
  showBillableData?: boolean;
  isPending: boolean;
  locations: InventoryLocation[];
  readOnly?: boolean;
  onTake: () => void;
  onReturn: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const stillOut = Math.max(0, line.takenQuantity - line.returnedQuantity);
  const canReturn = stillOut > 0 && (locations.length > 0 || !isAdminOrManager);

  return (
    <div className="rounded-md border bg-background p-3" data-testid="job-material-line">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{line.itemName}</p>
            <Badge variant="secondary" className="text-xs">
              {INVENTORY_ITEM_TYPE_LABELS[line.itemType]}
            </Badge>
            <Badge variant="secondary" className={statusClasses(line.status)}>
              {JOB_MATERIAL_STATUS_LABELS[line.status]}
            </Badge>
            {line.isUnplanned && (
              <Badge variant="outline" className="text-xs">
                Direkt entnommen
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {line.plannedQuantity > 0 && (
              <MovementPill tone="planned">
                Bedarf {formatInventoryQuantity(line.plannedQuantity, line.unit)}
              </MovementPill>
            )}
            {line.takenQuantity > 0 && (
              <MovementPill tone="take">
                -{formatInventoryQuantity(line.takenQuantity, line.unit)}
              </MovementPill>
            )}
            {line.returnedQuantity > 0 && (
              <MovementPill tone="return">
                +{formatInventoryQuantity(line.returnedQuantity, line.unit)}
              </MovementPill>
            )}
            {showBillableData && line.billableQuantity > 0 && (
              <MovementPill tone="planned">
                Abrechenbar {formatInventoryQuantity(line.billableQuantity, line.unit)}
              </MovementPill>
            )}
          </div>
          <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <span>Lager: {line.preferredLocationName ?? 'Nicht festgelegt'}</span>
            <span>
              Noch draußen: {formatInventoryQuantity(stillOut, line.unit)}
            </span>
          </div>
          {line.notes && (
            <p className="mt-2 text-xs text-muted-foreground">{line.notes}</p>
          )}
        </div>

        {!readOnly && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn('gap-1', isAdminOrManager ? 'h-8' : 'min-h-11')}
              onClick={onTake}
              disabled={isPending || (isAdminOrManager && locations.length === 0)}
            >
              <CheckCircle2 className="size-3.5" />
              Entnahme buchen
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn('gap-1', isAdminOrManager ? 'h-8' : 'min-h-11')}
              onClick={onReturn}
              disabled={isPending || !canReturn}
            >
              <RotateCcw className="size-3.5" />
              Zurücklegen
            </Button>
            {isAdminOrManager && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  onClick={onEdit}
                  disabled={isPending}
                  title="Position bearbeiten"
                >
                  <Pencil className="size-3.5" />
                  <span className="sr-only">Position bearbeiten</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={onDelete}
                  disabled={isPending}
                  title="Plan entfernen"
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Plan entfernen</span>
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MaterialSelectionDialog({
  dialog,
  setDialog,
  items,
  locations,
  isSaving,
  isSearching,
  onSave,
}: {
  dialog: MaterialDialogState | null;
  setDialog: (dialog: MaterialDialogState | null) => void;
  items: InventoryPickerOption[];
  locations: InventoryLocation[];
  isSaving: boolean;
  isSearching: boolean;
  onSave: () => void;
}) {
  const mode = dialog?.mode ?? 'plan';
  const selectedIds = new Set(dialog?.rows.map((row) => row.itemId) ?? []);
  const filteredItems = useMemo(
    () =>
      items
        .filter((item) => matchesItemSearch(item, dialog?.search ?? ''))
        .slice(0, 30),
    [dialog?.search, items]
  );

  if (!dialog) return null;

  const currentDialog = dialog;
  const canAddMultiple = mode === 'plan' || mode === 'take';
  const canChangeItem =
    mode !== 'return' &&
    (mode !== 'edit' ||
      currentDialog.rows.every(
        (row) => row.takenQuantity === 0 && row.returnedQuantity === 0
      ));

  function patchDialog(patch: Partial<MaterialDialogState>) {
    setDialog({ ...currentDialog, ...patch });
  }

  function addItem(item: InventoryPickerOption) {
    if (!canAddMultiple && currentDialog.rows.length > 0) {
      const existing = currentDialog.rows[0];
      patchDialog({
        rows: [
          {
            ...existing,
            itemId: item.id,
            locationId: getDefaultLocationId(item, locations, mode),
          },
        ],
        error: null,
      });
      return;
    }

    if (selectedIds.has(item.id)) {
      patchDialog({
        rows: currentDialog.rows.map((row) =>
          row.itemId === item.id
            ? {
                ...row,
                quantity: quantityToInput(decimalFromInput(row.quantity) + 1),
              }
            : row
        ),
        error: null,
      });
      return;
    }

    patchDialog({
      rows: [...currentDialog.rows, buildDialogRow(item, locations, mode)],
      error: null,
    });
  }

  function updateRow(key: string, patch: Partial<MaterialDialogRow>) {
    patchDialog({
      rows: currentDialog.rows.map((row) =>
        row.key === key ? { ...row, ...patch } : row
      ),
      error: null,
    });
  }

  function removeRow(key: string) {
    patchDialog({
      rows: currentDialog.rows.filter((row) => row.key !== key),
      error: null,
    });
  }

  const title =
    mode === 'plan'
      ? 'Material planen'
      : mode === 'take'
        ? 'Entnahme buchen'
        : mode === 'return'
          ? 'Material zurücklegen'
          : 'Materialposition bearbeiten';
  const description =
    mode === 'plan'
      ? 'Geplante Mengen beschreiben den Bedarf. Der Lagerbestand bleibt unverändert.'
      : mode === 'take'
        ? 'Diese Buchung zieht die gewählte Menge aus dem ausgewählten Lager ab.'
        : mode === 'return'
          ? 'Diese Buchung legt Material zurück und erhöht den Lagerbestand.'
          : 'Ändere Artikel, Lager, Menge oder Notiz der geplanten Position.';

  return (
    <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
        <DialogBody className="grid gap-5 py-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
          {canChangeItem ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={currentDialog.search}
                  onChange={(event) => patchDialog({ search: event.target.value })}
                  onKeyDown={(event) => {
                    // Enter while searching must never book the movement.
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                  className="pl-9"
                  aria-label="Artikel suchen"
                  placeholder="Artikel, SKU, Barcode, Lager, Lieferant suchen..."
                />
              </div>
              <div className="max-h-[420px] overflow-auto rounded-md border">
                {isSearching && filteredItems.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground" role="status">
                    Material wird gesucht…
                  </p>
                ) : filteredItems.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Keine passenden Artikel gefunden.
                  </p>
                ) : (
                  <div className="divide-y">
                    {filteredItems.map((item) => {
                      const hasStockForTake =
                        mode !== 'take' ||
                        item.stockByLocation.some((stock) => stock.quantityOnHand > 0);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => addItem(item)}
                          disabled={!hasStockForTake}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {item.name}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {item.internalSku && <span>SKU {item.internalSku}</span>}
                              {item.primaryBarcode && <span>Barcode {item.primaryBarcode}</span>}
                              {item.categoryName && <span>{item.categoryName}</span>}
                              {item.supplierName && <span>{item.supplierName}</span>}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {item.stockByLocation.length > 0
                                ? item.stockByLocation
                                    .map((stock) =>
                                      `${stock.locationName}: ${formatInventoryQuantity(
                                        stock.quantityOnHand,
                                        item.unit
                                      )}`
                                    )
                                    .join(' · ')
                                : 'Noch keinem Lager zugeordnet'}
                            </span>
                          </span>
                          <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
              Der Artikel kann nicht mehr geändert werden, weil für diese
              Position bereits Entnahmen oder Rückgaben gebucht wurden.
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Ausgewählte Positionen</Label>
              <Badge variant="secondary">{currentDialog.rows.length}</Badge>
            </div>
            {currentDialog.rows.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                Wähle links einen oder mehrere Artikel aus.
              </div>
            ) : (
              <div className="space-y-3">
                {currentDialog.rows.map((row) => {
                  const item = items.find((entry) => entry.id === row.itemId);
                  const locationOptions = getLocationOptions(item, locations, mode);
                  const unitLabel = item ? getInventoryUnitLabel(item.unit) : '';
                  const effectQuantity = item
                    ? formatInventoryQuantity(decimalFromInput(row.quantity), item.unit)
                    : row.quantity;
                  const fieldIdPrefix = `material-row-${row.key}`;
                  return (
                    <div key={row.key} className="rounded-md border bg-background p-3">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {item?.name ?? 'Artikel'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item?.categoryName ?? INVENTORY_ITEM_TYPE_LABELS[item?.itemType ?? 'material']}
                          </p>
                        </div>
                        {(canAddMultiple || mode === 'edit') && currentDialog.rows.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            onClick={() => removeRow(row.key)}
                          >
                            <X className="size-3.5" />
                            <span className="sr-only">Position entfernen</span>
                          </Button>
                        )}
                      </div>

                      <div className="space-y-3">
                        <Field label="Menge" htmlFor={`${fieldIdPrefix}-quantity`}>
                          <QuantityStepper
                            id={`${fieldIdPrefix}-quantity`}
                            value={row.quantity}
                            onChange={(value) => updateRow(row.key, { quantity: value })}
                            unitLabel={unitLabel}
                            min={0}
                          />
                        </Field>
                        <Field label="Lager" htmlFor={`${fieldIdPrefix}-location`}>
                          <SearchableSelect
                            id={`${fieldIdPrefix}-location`}
                            options={locationOptions.map((location) => ({
                              value: location.id,
                              label: location.label,
                            }))}
                            value={row.locationId}
                            onChange={(value) =>
                              updateRow(row.key, { locationId: value })
                            }
                            placeholder={
                              mode === 'plan' || mode === 'edit'
                                ? 'Nicht festgelegt'
                                : 'Lager wählen'
                            }
                            searchPlaceholder="Lager suchen …"
                            emptyMessage="Kein Lager gefunden"
                            allowNone={mode === 'plan' || mode === 'edit'}
                            noneLabel="Nicht festgelegt"
                          />
                        </Field>
                        <Field label="Notiz" htmlFor={`${fieldIdPrefix}-notes`}>
                          <Textarea
                            id={`${fieldIdPrefix}-notes`}
                            value={row.notes}
                            onChange={(event) =>
                              updateRow(row.key, { notes: event.target.value })
                            }
                            rows={2}
                          />
                        </Field>
                        <p
                          className={cn(
                            'rounded-md px-3 py-2 text-xs',
                            mode === 'take' &&
                              'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
                            mode === 'return' &&
                              'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300',
                            (mode === 'plan' || mode === 'edit') &&
                              'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                          )}
                        >
                          {mode === 'take'
                            ? `Diese Zeile zieht ${effectQuantity} aus dem Lager ab.`
                            : mode === 'return'
                              ? `Diese Zeile legt ${effectQuantity} zurück ins Lager.`
                              : 'Diese Zeile plant Bedarf. Der Bestand bleibt unverändert.'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <ErrorText className="lg:col-span-2">{currentDialog.error}</ErrorText>
        </DialogBody>

        <DialogFooter className="pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialog(null)}
            disabled={isSaving}
          >
            Abbrechen
          </Button>
          <Button
            type="submit"
            disabled={isSaving || currentDialog.rows.length === 0}
          >
            {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {mode === 'take'
              ? 'Entnahme buchen'
              : mode === 'return'
                ? 'Zurücklegen'
                : 'Speichern'}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
