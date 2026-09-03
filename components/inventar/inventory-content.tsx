'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Boxes,
  ClipboardList,
  FileUp,
  Loader2,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListRow } from '@/components/ui/list-row';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SelectWithCreate } from '@/components/ui/select-with-create';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  INVENTORY_ITEM_COLUMNS,
  INVENTORY_MOVEMENT_COLUMNS,
} from '@/components/inventar/inventory-table-columns';
import { LocationSelectWithCreate } from '@/components/inventar/location-select-with-create';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  adjustInventoryStock,
  createInventoryLocation,
  importInventoryRows,
  upsertInventoryItem,
  type ImportInventoryRowsInput,
  type InventoryImportRow,
} from '@/lib/inventory/actions';
import type {
  InventoryCategory,
  InventoryItemType,
  InventoryLocation,
  InventoryLocationType,
  InventoryOverview,
  InventoryOverviewItem,
  InventoryPickerOption,
  InventoryUnitOption,
} from '@/lib/inventory/types';
import {
  formatInventoryQuantity,
  getInventoryUnitLabel,
  INVENTORY_ITEM_TYPE_LABELS,
  INVENTORY_LOCATION_TYPE_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  INVENTORY_STOCK_STATUS_LABELS,
  INVENTORY_UNIT_OPTIONS,
} from '@/lib/inventory/types';
import { cn } from '@/lib/utils';

type InventoryContentProps = {
  overview: InventoryOverview;
};

type ItemFormState = {
  id: string | null;
  name: string;
  itemType: InventoryItemType;
  description: string;
  categoryId: string;
  unit: string;
  internalSku: string;
  manufacturer: string;
  supplierId: string;
  supplierName: string;
  supplierArticleNumber: string;
  purchasePrice: string;
  salePrice: string;
  isBillable: boolean;
  globalMinimumStock: string;
  globalTargetStock: string;
  initialLocationId: string;
  initialQuantity: string;
  barcode: string;
  notes: string;
};

type LocationFormState = {
  name: string;
  description: string;
  locationType: InventoryLocationType;
};

type StockDialogState = {
  item: InventoryOverviewItem;
  locationId: string;
  direction: 'add' | 'remove';
  quantity: string;
  reason: string;
} | null;

type ImportColumnKey = keyof InventoryImportRow;

const NONE_VALUE = '__none__';
const NEW_SUPPLIER_VALUE = '__new_supplier__';
const ALL_VALUE = '__all__';

const IMPORT_COLUMNS: Array<{ key: ImportColumnKey; label: string }> = [
  { key: 'name', label: 'Artikelname' },
  { key: 'itemType', label: 'Typ' },
  { key: 'categoryName', label: 'Kategorie' },
  { key: 'locationName', label: 'Lager' },
  { key: 'unit', label: 'Einheit' },
  { key: 'quantity', label: 'Bestand' },
  { key: 'minimumStock', label: 'Mindestbestand' },
  { key: 'targetStock', label: 'Zielbestand' },
  { key: 'internalSku', label: 'Interne SKU' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'manufacturer', label: 'Hersteller' },
  { key: 'supplierName', label: 'Lieferant' },
  { key: 'supplierArticleNumber', label: 'Lieferanten-Nr.' },
  { key: 'purchasePriceCents', label: 'Einkaufspreis' },
  { key: 'salePriceCents', label: 'Verkaufspreis' },
  { key: 'isBillable', label: 'Abrechenbar' },
  { key: 'notes', label: 'Notizen' },
];

const EMPTY_ITEM_FORM: ItemFormState = {
  id: null,
  name: '',
  itemType: 'material',
  description: '',
  categoryId: NONE_VALUE,
  unit: 'piece',
  internalSku: '',
  manufacturer: '',
  supplierId: NONE_VALUE,
  supplierName: '',
  supplierArticleNumber: '',
  purchasePrice: '',
  salePrice: '',
  isBillable: true,
  globalMinimumStock: '0',
  globalTargetStock: '',
  initialLocationId: '',
  initialQuantity: '',
  barcode: '',
  notes: '',
};

const EMPTY_LOCATION_FORM: LocationFormState = {
  name: '',
  description: '',
  locationType: 'room',
};

function decimalFromInput(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function centsFromInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed * 100));
}

function centsToInput(cents: number | null): string {
  if (cents === null) return '';
  return String(cents / 100).replace('.', ',');
}

function itemToForm(item: InventoryOverviewItem): ItemFormState {
  return {
    ...EMPTY_ITEM_FORM,
    id: item.id,
    name: item.name,
    itemType: item.itemType,
    description: item.description ?? '',
    categoryId: item.categoryId ?? NONE_VALUE,
    unit: item.unit,
    internalSku: item.internalSku ?? '',
    manufacturer: item.manufacturer ?? '',
    supplierId: item.supplierId ?? NONE_VALUE,
    supplierArticleNumber: item.supplierArticleNumber ?? '',
    purchasePrice: centsToInput(item.purchasePriceCents),
    salePrice: centsToInput(item.salePriceCents),
    isBillable: item.isBillable,
    globalMinimumStock: String(item.globalMinimumStock).replace('.', ','),
    globalTargetStock:
      item.globalTargetStock === null
        ? ''
        : String(item.globalTargetStock).replace('.', ','),
    initialLocationId: '',
    initialQuantity: '',
    barcode: item.primaryBarcode ?? '',
    notes: item.notes ?? '',
  };
}

function getInventoryActionErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    name_required: 'Bitte gib einen Namen ein.',
    unit_required: 'Bitte wähle eine Einheit aus.',
    location_required_for_initial_stock:
      'Bitte wähle zuerst ein Lager aus oder lege direkt in diesem Feld ein neues Lager an.',
    location_required: 'Bitte wähle ein Lager aus.',
    location_not_found: 'Das ausgewählte Lager wurde nicht gefunden.',
    category_not_found: 'Die ausgewählte Kategorie wurde nicht gefunden.',
    quantity_required: 'Bitte gib eine Menge größer als 0 ein.',
    stock_would_go_negative:
      'Der Bestand in diesem Lager reicht nicht aus. Wähle eine kleinere Menge oder ein anderes Lager.',
    save_failed: 'Der Artikel konnte nicht gespeichert werden.',
    create_failed: 'Das Lager konnte nicht gespeichert werden.',
    not_authorized: 'Du hast keine Berechtigung für diese Aktion.',
  };

  return messages[error] ?? 'Die Aktion konnte nicht abgeschlossen werden.';
}

function formatMovementTarget(movement: InventoryOverview['movements'][number]): {
  from: string;
  to: string;
} {
  const jobLabel = movement.jobNumber
    ? `Auftrag ${movement.jobNumber}`
    : movement.jobTitle
      ? `Auftrag ${movement.jobTitle}`
      : 'Auftrag';
  const projectLabel = movement.projectNumber
    ? `Projekt ${movement.projectNumber}`
    : movement.projectName
      ? `Projekt ${movement.projectName}`
      : 'Projekt';
  const targetLabel = movement.jobId
    ? movement.projectId
      ? `${jobLabel} · ${projectLabel}`
      : jobLabel
    : movement.projectId
      ? projectLabel
      : null;

  switch (movement.movementType) {
    case 'job_take':
      return {
        from: movement.locationName,
        to: targetLabel ?? 'Auftrag/Projekt',
      };
    case 'job_return':
      return {
        from: targetLabel ?? 'Auftrag/Projekt',
        to: movement.locationName,
      };
    case 'stock_in':
    case 'initial_count':
      return { from: 'Externe Quelle', to: movement.locationName };
    case 'stock_out':
      return { from: movement.locationName, to: 'Korrektur/Ausgang' };
    case 'transfer_in':
      return { from: 'Umlagerung', to: movement.locationName };
    case 'transfer_out':
      return { from: movement.locationName, to: 'Umlagerung' };
    default:
      return { from: movement.locationName, to: 'Korrektur' };
  }
}

function stockStatusClasses(status: InventoryOverviewItem['stockStatus']): string {
  switch (status) {
    case 'out_of_stock':
      return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300';
    case 'low_stock':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300';
    case 'in_stock':
      return 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-300';
  }
}

function itemTypeClasses(type: InventoryItemType): string {
  switch (type) {
    case 'material':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300';
    case 'consumable':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300';
    case 'tool':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300';
    case 'asset':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300';
  }
}

function matchesInventorySearch(item: InventoryOverviewItem, search: string): boolean {
  if (!search) return true;
  const query = search.toLowerCase();
  return [
    item.name,
    item.description,
    item.internalSku,
    item.manufacturer,
    item.supplierArticleNumber,
    item.categoryName,
    item.supplierName,
    item.primaryBarcode,
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(query));
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index++;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter =
    parseCsvLine(lines[0], ';').length >= parseCsvLine(lines[0], ',').length
      ? ';'
      : ',';
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, delimiter);
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = cells[index] ?? '';
      return acc;
    }, {});
  });

  return { headers, rows };
}

function guessMapping(headers: string[]): Partial<Record<ImportColumnKey, string>> {
  const lowerHeaders = headers.map((header) => ({
    original: header,
    lower: header.toLowerCase(),
  }));

  function find(...needles: string[]) {
    return lowerHeaders.find(({ lower }) =>
      needles.some((needle) => lower.includes(needle))
    )?.original;
  }

  return {
    name: find('artikel', 'name', 'bezeichnung', 'produkt'),
    itemType: find('typ', 'art'),
    categoryName: find('kategorie', 'gruppe'),
    locationName: find('lager', 'ort', 'standort'),
    unit: find('einheit', 'unit'),
    quantity: find('bestand', 'menge', 'anzahl'),
    minimumStock: find('mindest', 'minimum'),
    targetStock: find('zielbestand', 'sollbestand'),
    internalSku: find('sku', 'artikelnummer', 'nr.'),
    barcode: find('barcode', 'ean', 'gtin'),
    manufacturer: find('hersteller', 'manufacturer'),
    supplierName: find('lieferant', 'supplier'),
    supplierArticleNumber: find('lieferanten', 'lieferantennr'),
    purchasePriceCents: find('einkauf', 'ek'),
    salePriceCents: find('verkauf', 'vk'),
    isBillable: find('abrechenbar'),
    notes: find('notiz', 'bemerkung'),
  };
}

function parseItemType(value: string): InventoryItemType {
  const normalized = value.toLowerCase();
  if (normalized.includes('werkzeug') || normalized.includes('tool')) return 'tool';
  if (normalized.includes('anlage') || normalized.includes('gerät') || normalized.includes('asset')) {
    return 'asset';
  }
  if (normalized.includes('verbrauch')) return 'consumable';
  return 'material';
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (['ja', 'j', 'yes', 'true', '1'].includes(normalized)) return true;
  if (['nein', 'n', 'no', 'false', '0'].includes(normalized)) return false;
  return null;
}

function parseMoneyToCents(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/\s/g, '')
    .replace('EUR', '')
    .replace('€', '');
  if (!normalized) return null;

  const usesDotDecimal =
    !normalized.includes(',') && /^[+-]?\d+\.\d{1,2}$/.test(normalized);
  const cleaned = usesDotDecimal
    ? normalized
    : normalized.replace(/\./g, '').replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed * 100));
}

export function InventoryContent({ overview }: InventoryContentProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>(ALL_VALUE);
  const [stockFilter, setStockFilter] = useState<string>(ALL_VALUE);
  const [locationFilter, setLocationFilter] = useState<string>(ALL_VALUE);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemForm, setItemForm] = useState<ItemFormState>(EMPTY_ITEM_FORM);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [locationForm, setLocationForm] = useState<LocationFormState>(EMPTY_LOCATION_FORM);
  const [stockDialog, setStockDialog] = useState<StockDialogState>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { run: runInventoryTask, isPending } = usePendingTask();

  useRealtimeRouterRefresh({
    tables: [
      'inventory_categories',
      'inventory_locations',
      'inventory_suppliers',
      'inventory_items',
      'inventory_item_barcodes',
      'inventory_stock_levels',
      'inventory_import_batches',
      'job_material_lines',
      'inventory_movements',
      'inventory_asset_instances',
    ],
  });

  const filteredItems = useMemo(
    () =>
      overview.items.filter((item) => {
        if (!matchesInventorySearch(item, search.trim())) return false;
        if (typeFilter !== ALL_VALUE && item.itemType !== typeFilter) return false;
        if (stockFilter !== ALL_VALUE && item.stockStatus !== stockFilter) return false;
        if (
          locationFilter !== ALL_VALUE &&
          !item.stockByLocation.some((stock) => stock.locationId === locationFilter)
        ) {
          return false;
        }
        return true;
      }),
    [locationFilter, overview.items, search, stockFilter, typeFilter]
  );

  const plannedItems = useMemo(
    () => overview.items.filter((item) => item.plannedQuantity > 0),
    [overview.items]
  );
  const stockedItemCount = useMemo(
    () => overview.items.filter((item) => item.totalOnHand > 0).length,
    [overview.items]
  );

  const pickerItems: InventoryPickerOption[] = useMemo(
    () =>
      overview.items.map((item) => ({
        id: item.id,
        itemType: item.itemType,
        name: item.name,
        unit: item.unit,
        internalSku: item.internalSku,
        manufacturer: item.manufacturer,
        supplierName: item.supplierName,
        supplierArticleNumber: item.supplierArticleNumber,
        primaryBarcode: item.primaryBarcode,
        categoryName: item.categoryName,
        isBillable: item.isBillable,
        availableQuantity: item.availableQuantity,
        stockByLocation: item.stockByLocation,
      })),
    [overview.items]
  );

  function openCreateItemDialog() {
    setFormError(null);
    setItemForm(EMPTY_ITEM_FORM);
    setItemDialogOpen(true);
  }

  function openEditItemDialog(item: InventoryOverviewItem) {
    setFormError(null);
    setItemForm(itemToForm(item));
    setItemDialogOpen(true);
  }

  function handleItemSave() {
    setFormError(null);
    const initialQuantity = decimalFromInput(itemForm.initialQuantity);
    if (!itemForm.id && initialQuantity > 0 && !itemForm.initialLocationId) {
      setFormError(getInventoryActionErrorMessage('location_required_for_initial_stock'));
      return;
    }

    void runInventoryTask(async () => {
      const result = await upsertInventoryItem({
        id: itemForm.id ?? undefined,
        name: itemForm.name,
        itemType: itemForm.itemType,
        description: itemForm.description,
        categoryId:
          itemForm.categoryId === NONE_VALUE ? null : itemForm.categoryId,
        unit: itemForm.unit,
        internalSku: itemForm.internalSku,
        manufacturer: itemForm.manufacturer,
        supplierId:
          itemForm.supplierId === NONE_VALUE ||
          itemForm.supplierId === NEW_SUPPLIER_VALUE
            ? null
            : itemForm.supplierId,
        supplierName:
          itemForm.supplierId === NEW_SUPPLIER_VALUE
            ? itemForm.supplierName
            : null,
        supplierArticleNumber: itemForm.supplierArticleNumber,
        purchasePriceCents: centsFromInput(itemForm.purchasePrice),
        salePriceCents: centsFromInput(itemForm.salePrice),
        isBillable: itemForm.isBillable,
        globalMinimumStock: decimalFromInput(itemForm.globalMinimumStock),
        globalTargetStock: itemForm.globalTargetStock
          ? decimalFromInput(itemForm.globalTargetStock)
          : null,
        trackQuantity: true,
        trackIndividualAssets:
          itemForm.itemType === 'tool' || itemForm.itemType === 'asset',
        barcode: itemForm.barcode,
        notes: itemForm.notes,
        initialLocationId: itemForm.id ? null : itemForm.initialLocationId || null,
        initialQuantity: itemForm.id ? null : initialQuantity,
      });

      if (!result.success) {
        setFormError(getInventoryActionErrorMessage(result.error));
        return;
      }

      setItemDialogOpen(false);
      showBanner({
        variant: 'success',
        message: itemForm.id
          ? 'Der Artikel wurde gespeichert.'
          : 'Der Artikel wurde angelegt.',
      });
      router.refresh();
    });
  }

  function handleLocationSave() {
    setFormError(null);
    void runInventoryTask(async () => {
      const result = await createInventoryLocation(locationForm);
      if (!result.success) {
        setFormError(getInventoryActionErrorMessage(result.error));
        return;
      }

      setLocationDialogOpen(false);
      setLocationForm(EMPTY_LOCATION_FORM);
      showBanner({ variant: 'success', message: 'Das Lager wurde angelegt.' });
      router.refresh();
    });
  }

  function handleStockSave() {
    if (!stockDialog) return;

    setFormError(null);
    void runInventoryTask(async () => {
      const result = await adjustInventoryStock({
        itemId: stockDialog.item.id,
        locationId: stockDialog.locationId,
        direction: stockDialog.direction,
        quantity: decimalFromInput(stockDialog.quantity),
        reason: stockDialog.reason,
      });

      if (!result.success) {
        setFormError(getInventoryActionErrorMessage(result.error));
        return;
      }

      setStockDialog(null);
      showBanner({
        variant: 'success',
        message: 'Der Bestand wurde angepasst.',
      });
      router.refresh();
    });
  }

  function openStockDialog(item: InventoryOverviewItem) {
    setFormError(null);
    setStockDialog({
      item,
      locationId:
        item.stockByLocation[0]?.locationId ?? overview.locations[0]?.id ?? '',
      direction: 'add',
      quantity: '',
      reason: '',
    });
  }

  return (
    <PageShell>
      <PageHeader
        title="Inventar"
        subtitle={`${overview.summary.totalItems} Artikel · ${overview.locations.length} Lager · ${plannedItems.length} geplante Artikel`}
        actions={
          <>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setImportDialogOpen(true)}
            >
              <FileUp className="size-4" />
              CSV importieren
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setFormError(null);
                setLocationForm(EMPTY_LOCATION_FORM);
                setLocationDialogOpen(true);
              }}
            >
              <Warehouse className="size-4" />
              Lager
            </Button>
            <Button className="gap-2" onClick={openCreateItemDialog}>
              <Plus className="size-4" />
              Artikel
            </Button>
          </>
        }
      />

      <PageBody>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryTile
            label="Artikel mit Bestand"
            value={String(stockedItemCount)}
            icon={<Boxes className="size-4" />}
          />
          <SummaryTile
            label="Knapp"
            value={String(overview.summary.lowStockItems)}
            icon={<SlidersHorizontal className="size-4" />}
          />
          <SummaryTile
            label="Leer"
            value={String(overview.summary.outOfStockItems)}
            icon={<ClipboardList className="size-4" />}
          />
          <SummaryTile
            label="Geplante Artikel"
            value={String(plannedItems.length)}
            icon={<PackagePlus className="size-4" />}
          />
        </div>

        <Tabs defaultValue="all" className="mt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList>
              <TabsTrigger value="all">Alle Artikel</TabsTrigger>
              <TabsTrigger value="locations">Lager</TabsTrigger>
              <TabsTrigger value="planned">Geplant</TabsTrigger>
              <TabsTrigger value="movements">Bewegungen</TabsTrigger>
            </TabsList>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="relative min-w-0 md:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Suchen"
                  aria-label="Artikel suchen"
                  className="pl-8"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="md:w-44" aria-label="Nach Typ filtern">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Alle Typen</SelectItem>
                  {Object.entries(INVENTORY_ITEM_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stockFilter} onValueChange={setStockFilter}>
                <SelectTrigger className="md:w-40" aria-label="Nach Bestand filtern">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Alle Bestände</SelectItem>
                  {Object.entries(INVENTORY_STOCK_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="md:w-44">
                <SearchableSelect
                  ariaLabel="Nach Lager filtern"
                  options={[
                    { value: ALL_VALUE, label: 'Alle Lager' },
                    ...overview.locations.map((location) => ({
                      value: location.id,
                      label: location.name,
                    })),
                  ]}
                  value={locationFilter}
                  onChange={setLocationFilter}
                  searchPlaceholder="Lager suchen …"
                  emptyMessage="Kein Lager gefunden"
                />
              </div>
            </div>
          </div>

          <TabsContent value="all" className="mt-4">
            <InventoryTable
              items={filteredItems}
              onEdit={openEditItemDialog}
              onAdjust={openStockDialog}
            />
          </TabsContent>

          <TabsContent value="locations" className="mt-4">
            <LocationsView locations={overview.locations} items={overview.items} />
          </TabsContent>

          <TabsContent value="planned" className="mt-4">
            <InventoryTable
              items={plannedItems}
              onEdit={openEditItemDialog}
              onAdjust={openStockDialog}
            />
          </TabsContent>

          <TabsContent value="movements" className="mt-4">
            <MovementsTable movements={overview.movements} />
          </TabsContent>
        </Tabs>
      </PageBody>

      <ItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        form={itemForm}
        setForm={setItemForm}
        categories={overview.categories}
        suppliers={overview.suppliers}
        locations={overview.locations}
        isSaving={isPending}
        error={formError}
        onSave={handleItemSave}
      />

      <LocationDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        form={locationForm}
        setForm={setLocationForm}
        isSaving={isPending}
        error={formError}
        onSave={handleLocationSave}
      />

      <StockAdjustmentDialog
        state={stockDialog}
        setState={setStockDialog}
        locations={overview.locations}
        isSaving={isPending}
        error={formError}
        onSave={handleStockSave}
      />

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        pickerItems={pickerItems}
        locations={overview.locations}
        categories={overview.categories}
        onImported={() => router.refresh()}
      />
    </PageShell>
  );
}

function SummaryTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function InventoryTable({
  items,
  onEdit,
  onAdjust,
}: {
  items: InventoryOverviewItem[];
  onEdit: (item: InventoryOverviewItem) => void;
  onAdjust: (item: InventoryOverviewItem) => void;
}) {
  return (
    <>
      <div className="space-y-2 md:hidden">
        {items.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
            Keine Artikel gefunden.
          </div>
        ) : (
          items.map((item) => (
            <ListRow key={item.id} className="items-start">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">{item.name}</p>
                  <Badge
                    variant="outline"
                    className={cn('shrink-0', stockStatusClasses(item.stockStatus))}
                  >
                    {INVENTORY_STOCK_STATUS_LABELS[item.stockStatus]}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{INVENTORY_ITEM_TYPE_LABELS[item.itemType]}</span>
                  {item.internalSku && <span>SKU {item.internalSku}</span>}
                  {item.categoryName && <span>{item.categoryName}</span>}
                </div>
                <p className="text-xs tabular-nums">
                  <span className="font-medium">
                    {formatInventoryQuantity(item.availableQuantity, item.unit)} verfügbar
                  </span>
                  <span className="text-muted-foreground">
                    {' '}· Bestand {formatInventoryQuantity(item.totalOnHand, item.unit)} · Geplant{' '}
                    {formatInventoryQuantity(item.plannedQuantity, item.unit)}
                  </span>
                </p>
                {item.stockByLocation.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {item.stockByLocation
                      .slice(0, 2)
                      .map(
                        (stock) =>
                          `${stock.locationName} ${formatInventoryQuantity(stock.quantityOnHand, item.unit)}`
                      )
                      .join(' · ')}
                    {item.stockByLocation.length > 2 &&
                      ` · +${item.stockByLocation.length - 2} weitere`}
                  </p>
                )}
              </div>
              <ItemActionsMenu item={item} onEdit={onEdit} onAdjust={onAdjust} />
            </ListRow>
          ))
        )}
      </div>

      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {INVENTORY_ITEM_COLUMNS.map((column) => (
                <TableHead key={column.id} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={INVENTORY_ITEM_COLUMNS.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  Keine Artikel gefunden.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="min-w-48">
                    <p className="font-medium">{item.name}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {item.internalSku && <span>SKU {item.internalSku}</span>}
                      {item.primaryBarcode && <span>Barcode {item.primaryBarcode}</span>}
                      {item.categoryName && <span>{item.categoryName}</span>}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={itemTypeClasses(item.itemType)}>
                    {INVENTORY_ITEM_TYPE_LABELS[item.itemType]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {item.stockByLocation.length === 0 ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <div className="space-y-1">
                      {item.stockByLocation.slice(0, 2).map((stock) => (
                        <div key={stock.locationId} className="text-xs">
                          <span className="font-medium">{stock.locationName}</span>{' '}
                          <span className="text-muted-foreground">
                            {formatInventoryQuantity(stock.quantityOnHand, item.unit)}
                          </span>
                        </div>
                      ))}
                      {item.stockByLocation.length > 2 && (
                        <p className="text-xs text-muted-foreground">
                          +{item.stockByLocation.length - 2} weitere
                        </p>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatInventoryQuantity(item.totalOnHand, item.unit)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatInventoryQuantity(item.plannedQuantity, item.unit)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatInventoryQuantity(item.availableQuantity, item.unit)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={stockStatusClasses(item.stockStatus)}>
                    {INVENTORY_STOCK_STATUS_LABELS[item.stockStatus]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <ItemActionsMenu item={item} onEdit={onEdit} onAdjust={onAdjust} />
                </TableCell>
              </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function ItemActionsMenu({
  item,
  onEdit,
  onAdjust,
}: {
  item: InventoryOverviewItem;
  onEdit: (item: InventoryOverviewItem) => void;
  onAdjust: (item: InventoryOverviewItem) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Aktionen</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onAdjust(item)}>
          <SlidersHorizontal className="mr-2 size-4" />
          Bestand ändern
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(item)}>
          <Pencil className="mr-2 size-4" />
          Bearbeiten
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MovementsTable({ movements }: { movements: InventoryOverview['movements'] }) {
  return (
    <>
      <div className="space-y-2 md:hidden">
        {movements.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
            Noch keine Bewegungen erfasst.
          </div>
        ) : (
          movements.map((movement) => {
            const target = formatMovementTarget(movement);
            return (
              <ListRow key={movement.id} className="items-start">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{movement.itemName}</p>
                    <span
                      className={cn(
                        'shrink-0 text-sm font-medium tabular-nums',
                        movement.quantityDelta < 0
                          ? 'text-red-600 dark:text-red-300'
                          : 'text-green-700 dark:text-green-300'
                      )}
                    >
                      {movement.quantityDelta > 0 ? '+' : ''}
                      {movement.quantityDelta.toLocaleString('de-DE')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {INVENTORY_MOVEMENT_TYPE_LABELS[movement.movementType]} ·{' '}
                    {formatDateTime(movement.createdAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {target.from} → {target.to}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    Vorher {movement.quantityBefore.toLocaleString('de-DE')} · Danach{' '}
                    {movement.quantityAfter.toLocaleString('de-DE')}
                  </p>
                  {movement.reason && (
                    <p className="text-xs text-muted-foreground">Grund: {movement.reason}</p>
                  )}
                </div>
              </ListRow>
            );
          })
        )}
      </div>

      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {INVENTORY_MOVEMENT_COLUMNS.map((column) => (
                <TableHead key={column.id} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={INVENTORY_MOVEMENT_COLUMNS.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  Noch keine Bewegungen erfasst.
                </TableCell>
              </TableRow>
            ) : (
              movements.map((movement) => {
                const target = formatMovementTarget(movement);
                return (
                  <TableRow key={movement.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(movement.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">{movement.itemName}</TableCell>
                    <TableCell>{movement.locationName}</TableCell>
                    <TableCell>{target.from}</TableCell>
                    <TableCell>{target.to}</TableCell>
                    <TableCell>
                      {INVENTORY_MOVEMENT_TYPE_LABELS[movement.movementType]}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {movement.quantityBefore.toLocaleString('de-DE')}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        movement.quantityDelta < 0
                          ? 'text-red-600 dark:text-red-300'
                          : 'text-green-700 dark:text-green-300'
                      )}
                    >
                      {movement.quantityDelta > 0 ? '+' : ''}
                      {movement.quantityDelta.toLocaleString('de-DE')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {movement.quantityAfter.toLocaleString('de-DE')}
                    </TableCell>
                    <TableCell>{movement.reason ?? '—'}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function LocationsView({
  locations,
  items,
}: {
  locations: InventoryLocation[];
  items: InventoryOverviewItem[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {locations.map((location) => {
        const locationItems = items.filter((item) =>
          item.stockByLocation.some((stock) => stock.locationId === location.id)
        );
        return (
          <div key={location.id} className="rounded-lg border bg-card p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Warehouse className="size-4 text-muted-foreground" />
                  <h2 className="font-semibold">{location.name}</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {INVENTORY_LOCATION_TYPE_LABELS[location.locationType]}
                </p>
              </div>
              <Badge variant="secondary">
                {locationItems.length} Artikel
              </Badge>
            </div>
            <div className="mb-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
              Artikel in diesem Lager:{' '}
              <span className="font-medium tabular-nums">
                {locationItems.length.toLocaleString('de-DE')}
              </span>
            </div>
            {locationItems.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Keine Artikel in diesem Lager.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {locationItems.slice(0, 6).map((item) => {
                  const stock = item.stockByLocation.find(
                    (entry) => entry.locationId === location.id
                  );
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatInventoryQuantity(stock?.quantityOnHand ?? 0, item.unit)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ItemDialog({
  open,
  onOpenChange,
  form,
  setForm,
  categories,
  suppliers,
  locations,
  isSaving,
  error,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ItemFormState;
  setForm: (form: ItemFormState) => void;
  categories: InventoryCategory[];
  suppliers: Array<{ id: string; name: string }>;
  locations: InventoryLocation[];
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const unitOptions: InventoryUnitOption[] = INVENTORY_UNIT_OPTIONS;
  const initialQuantity = decimalFromInput(form.initialQuantity);
  const [attempted, setAttempted] = useState(false);
  const nameError =
    attempted && !form.name.trim() ? 'Bitte gib einen Namen ein.' : undefined;
  const initialLocationError =
    attempted && !form.id && initialQuantity > 0 && !form.initialLocationId
      ? 'Wähle ein Lager für den Startbestand.'
      : undefined;

  const supplierItems = useMemo(() => {
    const items: Array<{ id: string; name: string }> = [...suppliers];
    if (form.supplierId === NEW_SUPPLIER_VALUE && form.supplierName) {
      items.push({ id: NEW_SUPPLIER_VALUE, name: `${form.supplierName} (neu)` });
    }
    return items;
  }, [suppliers, form.supplierId, form.supplierName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Artikel bearbeiten' : 'Artikel anlegen'}</DialogTitle>
          <DialogDescription>
            Stammdaten, Lagerkennzahlen und Barcode für den Inventarartikel.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!form.name.trim()) {
              document.getElementById('inventory-item-name')?.focus();
              return;
            }
            if (!form.id && initialQuantity > 0 && !form.initialLocationId) {
              document.getElementById('inventory-item-initial-location')?.focus();
              return;
            }
            onSave();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
        <DialogBody className="grid gap-4 py-1 sm:grid-cols-2">
          <h3 className="text-sm font-semibold sm:col-span-2">Stammdaten</h3>
          <Field label="Name" htmlFor="inventory-item-name" required error={nameError}>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Typ" htmlFor="inventory-item-type">
            <Select
              value={form.itemType}
              onValueChange={(value) =>
                setForm({ ...form, itemType: value as InventoryItemType })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INVENTORY_ITEM_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kategorie" htmlFor="inventory-item-category">
            <SearchableSelect
              options={categories.map((category) => ({
                value: category.id,
                label: category.name,
              }))}
              value={form.categoryId === NONE_VALUE ? '' : form.categoryId}
              onChange={(value) =>
                setForm({ ...form, categoryId: value || NONE_VALUE })
              }
              placeholder="Keine Kategorie"
              searchPlaceholder="Kategorie suchen …"
              emptyMessage="Keine Kategorie gefunden"
              allowNone
              noneLabel="Keine Kategorie"
            />
          </Field>
          <Field label="Einheit" htmlFor="inventory-item-unit">
            <SearchableSelect
              options={unitOptions}
              value={form.unit}
              onChange={(value) => setForm({ ...form, unit: value })}
              searchPlaceholder="Einheit suchen …"
              emptyMessage="Keine Einheit gefunden"
            />
          </Field>
          <h3 className="border-t pt-4 text-sm font-semibold sm:col-span-2">
            Bestand & Kennzeichnung
          </h3>
          {!form.id && (
            <>
              <Field
                label="Lager"
                htmlFor="inventory-item-initial-location"
                error={initialLocationError}
              >
                <LocationSelectWithCreate
                  locations={locations}
                  value={form.initialLocationId}
                  onValueChange={(value) =>
                    setForm({ ...form, initialLocationId: value })
                  }
                  placeholder="Lager wählen oder erstellen"
                  allowNone
                  noneLabel="Noch kein Lager"
                />
              </Field>
              <Field
                label="Startbestand"
                htmlFor="inventory-item-initial-quantity"
                description={
                  initialQuantity > 0
                    ? `Beim Speichern werden ${formatInventoryQuantity(
                        initialQuantity,
                        form.unit
                      )} in das gewählte Lager gebucht.`
                    : 'Ohne Startbestand wird nur der Artikel angelegt.'
                }
              >
                <QuantityStepper
                  value={form.initialQuantity}
                  onChange={(value) =>
                    setForm({ ...form, initialQuantity: value })
                  }
                  unitLabel={getInventoryUnitLabel(form.unit)}
                  min={0}
                />
              </Field>
            </>
          )}
          <Field label="Interne SKU" htmlFor="inventory-item-internal-sku">
            <Input
              value={form.internalSku}
              onChange={(event) =>
                setForm({ ...form, internalSku: event.target.value })
              }
            />
          </Field>
          <Field label="Barcode" htmlFor="inventory-item-barcode">
            <Input
              value={form.barcode}
              onChange={(event) => setForm({ ...form, barcode: event.target.value })}
            />
          </Field>
          <Field label="Mindestbestand" htmlFor="inventory-item-minimum-stock">
            <Input
              inputMode="decimal"
              value={form.globalMinimumStock}
              onChange={(event) =>
                setForm({ ...form, globalMinimumStock: event.target.value })
              }
            />
          </Field>
          <Field label="Zielbestand" htmlFor="inventory-item-target-stock">
            <Input
              inputMode="decimal"
              value={form.globalTargetStock}
              onChange={(event) =>
                setForm({ ...form, globalTargetStock: event.target.value })
              }
            />
          </Field>
          <h3 className="border-t pt-4 text-sm font-semibold sm:col-span-2">
            Lieferant & Preise
          </h3>
          <Field label="Hersteller" htmlFor="inventory-item-manufacturer">
            <Input
              value={form.manufacturer}
              onChange={(event) =>
                setForm({ ...form, manufacturer: event.target.value })
              }
            />
          </Field>
          <Field label="Lieferant" htmlFor="inventory-item-supplier">
            <SelectWithCreate
              items={supplierItems}
              getOption={(supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })}
              value={form.supplierId === NONE_VALUE ? '' : form.supplierId}
              onValueChange={(value) => {
                // The quick-create path writes id and name atomically via
                // onCreated below; skipping here avoids an ordering dependency
                // between the two same-tick setForm calls.
                if (value === NEW_SUPPLIER_VALUE) return;
                setForm({
                  ...form,
                  supplierId: value || NONE_VALUE,
                  // A picked existing supplier clears any pending new name.
                  supplierName: '',
                });
              }}
              createLabel="Neuen Lieferanten anlegen"
              renderCreateDialog={({ open: createOpen, onOpenChange: onCreateOpenChange, onCreated }) => (
                <SupplierQuickCreateDialog
                  open={createOpen}
                  onOpenChange={onCreateOpenChange}
                  onCreated={onCreated}
                />
              )}
              onCreated={(supplier) =>
                setForm({
                  ...form,
                  supplierId: NEW_SUPPLIER_VALUE,
                  supplierName: supplier.name,
                })
              }
              placeholder="Kein Lieferant"
              searchPlaceholder="Lieferant suchen …"
              emptyMessage="Kein Lieferant gefunden"
              allowNone
              noneLabel="Kein Lieferant"
            />
          </Field>
          <Field label="Lieferanten-Nr." htmlFor="inventory-item-supplier-number">
            <Input
              value={form.supplierArticleNumber}
              onChange={(event) =>
                setForm({ ...form, supplierArticleNumber: event.target.value })
              }
            />
          </Field>
          <Field label="Einkaufspreis" htmlFor="inventory-item-purchase-price">
            <Input
              inputMode="decimal"
              value={form.purchasePrice}
              onChange={(event) =>
                setForm({ ...form, purchasePrice: event.target.value })
              }
            />
          </Field>
          <Field label="Verkaufspreis" htmlFor="inventory-item-sale-price">
            <Input
              inputMode="decimal"
              value={form.salePrice}
              onChange={(event) =>
                setForm({ ...form, salePrice: event.target.value })
              }
            />
          </Field>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <Checkbox
              id="inventory-item-billable"
              checked={form.isBillable}
              onCheckedChange={(checked) =>
                setForm({ ...form, isBillable: checked === true })
              }
            />
            <Label htmlFor="inventory-item-billable">Abrechenbar</Label>
          </div>
          <h3 className="border-t pt-4 text-sm font-semibold sm:col-span-2">
            Beschreibung & Notizen
          </h3>
          <div className="sm:col-span-2">
            <Field label="Beschreibung" htmlFor="inventory-item-description">
              <Textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notizen" htmlFor="inventory-item-notes">
              <Textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <ErrorText>{error}</ErrorText>
          </div>
        </DialogBody>
        <DialogFooter className="pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SupplierQuickCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supplier: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('');

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // React synthetic submit events bubble through the portal along the REACT
    // tree: without stopPropagation this nested dialog's submit also fires the
    // surrounding ItemDialog form and saves the item prematurely.
    event.stopPropagation();
    const trimmed = name.trim();
    if (!trimmed) return;
    // The supplier row itself is created server-side when the item is saved
    // (upsertInventoryItem's supplierName path); this dialog only stages the
    // name as the pending selection.
    onCreated({ id: NEW_SUPPLIER_VALUE, name: trimmed });
    setName('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Neuen Lieferanten anlegen</DialogTitle>
          <DialogDescription>
            Der Lieferant wird beim Speichern des Artikels angelegt.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field label="Name" htmlFor="inventory-new-supplier-name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Großhandel Nord GmbH"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Übernehmen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LocationDialog({
  open,
  onOpenChange,
  form,
  setForm,
  isSaving,
  error,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: LocationFormState;
  setForm: (form: LocationFormState) => void;
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const [attempted, setAttempted] = useState(false);
  const nameError =
    attempted && !form.name.trim() ? 'Bitte gib einen Namen ein.' : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lager anlegen</DialogTitle>
          <DialogDescription>Räume, Lagerhallen, Regale oder Fahrzeuge.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!form.name.trim()) {
              document.getElementById('inventory-location-name')?.focus();
              return;
            }
            onSave();
          }}
          noValidate
          className="space-y-4"
        >
          <Field label="Name" htmlFor="inventory-location-name" required error={nameError}>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Typ" htmlFor="inventory-location-type">
            <Select
              value={form.locationType}
              onValueChange={(value) =>
                setForm({ ...form, locationType: value as InventoryLocationType })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INVENTORY_LOCATION_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Beschreibung" htmlFor="inventory-location-description">
            <Textarea
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StockAdjustmentDialog({
  state,
  setState,
  locations,
  isSaving,
  error,
  onSave,
}: {
  state: StockDialogState;
  setState: (state: StockDialogState) => void;
  locations: InventoryLocation[];
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const quantity = state ? decimalFromInput(state.quantity) : 0;
  const selectedLocation = state
    ? locations.find((location) => location.id === state.locationId)
    : null;
  const [attempted, setAttempted] = useState(false);
  const locationError =
    attempted && state && !state.locationId ? 'Bitte wähle ein Lager.' : undefined;
  const quantityError =
    attempted && state && quantity <= 0
      ? 'Bitte gib eine Menge größer als 0 ein.'
      : undefined;

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && setState(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bestand ändern</DialogTitle>
          <DialogDescription>{state?.item.name}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!state?.locationId) {
              document.getElementById('inventory-stock-location')?.focus();
              return;
            }
            if (quantity <= 0) {
              document.getElementById('inventory-stock-quantity')?.focus();
              return;
            }
            onSave();
          }}
          noValidate
          className="space-y-4"
        >
        {state && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label id="inventory-stock-action-label">Aktion</Label>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-labelledby="inventory-stock-action-label"
              >
                <Button
                  type="button"
                  variant={state.direction === 'add' ? 'default' : 'outline'}
                  onClick={() => setState({ ...state, direction: 'add' })}
                >
                  Hinzufügen
                </Button>
                <Button
                  type="button"
                  variant={state.direction === 'remove' ? 'default' : 'outline'}
                  onClick={() => setState({ ...state, direction: 'remove' })}
                >
                  Entnehmen
                </Button>
              </div>
            </div>
            <Field
              label="Lager"
              htmlFor="inventory-stock-location"
              required
              error={locationError}
            >
              <LocationSelectWithCreate
                locations={locations}
                value={state.locationId}
                onValueChange={(value) =>
                  setState({ ...state, locationId: value })
                }
                placeholder="Lager wählen oder erstellen"
              />
            </Field>
            <Field
              label={`Menge (${getInventoryUnitLabel(state.item.unit)})`}
              htmlFor="inventory-stock-quantity"
              required
              error={quantityError}
            >
              <QuantityStepper
                value={state.quantity}
                onChange={(value) => setState({ ...state, quantity: value })}
                unitLabel={getInventoryUnitLabel(state.item.unit)}
                min={0}
              />
            </Field>
            <Field label="Grund" htmlFor="inventory-stock-reason">
              <Textarea
                value={state.reason}
                onChange={(event) =>
                  setState({ ...state, reason: event.target.value })
                }
              />
            </Field>
            <p
              className={cn(
                'rounded-md px-3 py-2 text-sm',
                state.direction === 'add'
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
              )}
            >
              {state.direction === 'add'
                ? `Diese Aktion fügt ${formatInventoryQuantity(
                    quantity,
                    state.item.unit
                  )} ${selectedLocation ? `zu ${selectedLocation.name}` : 'zum Inventar'} hinzu.`
                : `Diese Aktion zieht ${formatInventoryQuantity(
                    quantity,
                    state.item.unit
                  )} ${selectedLocation ? `aus ${selectedLocation.name}` : 'aus dem Inventar'} ab.`}
            </p>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setState(null)}
            disabled={isSaving}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  pickerItems,
  locations,
  categories,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickerItems: InventoryPickerOption[];
  locations: InventoryLocation[];
  categories: InventoryCategory[];
  onImported: () => void;
}) {
  const { showBanner } = useBanner();
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportColumnKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const { run: runImportTask, isPending } = usePendingTask();
  const [attempted, setAttempted] = useState(false);
  const fileError =
    attempted && rows.length === 0
      ? 'Wähle eine CSV-Datei mit mindestens einer Datenzeile.'
      : undefined;
  const nameMappingError =
    attempted && rows.length > 0 && !mapping.name
      ? 'Ordne die Spalte mit dem Artikelnamen zu.'
      : undefined;

  function resetImportState() {
    setFileName('');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setError(null);
    setAttempted(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetImportState();
    onOpenChange(nextOpen);
  }

  function handleFile(file: File | null) {
    setError(null);
    if (!file) return;

    file
      .text()
      .then((content) => {
        const parsed = parseCsv(content);
        setFileName(file.name);
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        setMapping(guessMapping(parsed.headers));
      })
      .catch(() => setError('Die Datei konnte nicht gelesen werden.'));
  }

  function handleImport() {
    setError(null);
    void runImportTask(async () => {
      const normalizedRows: InventoryImportRow[] = rows.map((row) => {
        const read = (key: ImportColumnKey) => {
          const header = mapping[key];
          return header ? row[header] ?? '' : '';
        };

        return {
          name: read('name'),
          itemType: read('itemType') ? parseItemType(read('itemType')) : 'material',
          categoryName: read('categoryName') || null,
          locationName: read('locationName') || null,
          unit: read('unit') || null,
          quantity: decimalFromInput(read('quantity')),
          minimumStock: decimalFromInput(read('minimumStock')),
          targetStock: read('targetStock') ? decimalFromInput(read('targetStock')) : null,
          internalSku: read('internalSku') || null,
          barcode: read('barcode') || null,
          manufacturer: read('manufacturer') || null,
          supplierName: read('supplierName') || null,
          supplierArticleNumber: read('supplierArticleNumber') || null,
          purchasePriceCents: parseMoneyToCents(read('purchasePriceCents')),
          salePriceCents: parseMoneyToCents(read('salePriceCents')),
          isBillable: parseBoolean(read('isBillable')),
          notes: read('notes') || null,
        };
      });

      const payload: ImportInventoryRowsInput = {
        fileName: fileName || 'inventar-import.csv',
        columnMapping: Object.fromEntries(
          Object.entries(mapping).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        rows: normalizedRows,
      };

      const result = await importInventoryRows(payload);
      if (!result.success) {
        setError('Der Import konnte nicht abgeschlossen werden.');
        return;
      }

      handleOpenChange(false);
      showBanner({
        variant: 'success',
        message: 'Der Import wurde abgeschlossen.',
      });
      onImported();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>CSV importieren</DialogTitle>
          <DialogDescription>
            {rows.length > 0
              ? `${rows.length} Zeilen erkannt`
              : `${pickerItems.length} bestehende Artikel, ${locations.length} Lager, ${categories.length} Kategorien`}
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

        <DialogFooter className="pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Importieren
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
