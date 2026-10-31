'use client';

import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { readInBackground } from '@/lib/data/background-read-client';
import type { InventoryLocation, InventoryPickerOption, JobMaterialLine } from '@/lib/inventory/types';
import { normalizeSearchText } from '@/lib/ui/search';
import {
  buildDialogRow,
  itemFromLine,
  type MaterialDialogMode,
  type MaterialDialogState,
} from './job-material-dialog-model';

type JobMaterialDialog = {
  dialog: MaterialDialogState | null;
  setDialog: Dispatch<SetStateAction<MaterialDialogState | null>>;
  sectionError: string | null;
  pickerItems: InventoryPickerOption[];
  pickerLocations: InventoryLocation[];
  isPickerLoading: boolean;
  /** The catalog search for the current text failed; `retrySearch` asks the server again. */
  searchFailed: boolean;
  retrySearch: () => void;
  openDialog: (mode: MaterialDialogMode, line?: JobMaterialLine) => Promise<void>;
};

type JobMaterialDialogOptions = {
  jobId: string | undefined;
  isAdminOrManager: boolean;
  inventoryItems: InventoryPickerOption[];
  locations: InventoryLocation[];
};

/** Who reads the catalog: the office searches the organization, a worker the assigned job. */
type CatalogReader = Pick<JobMaterialDialogOptions, 'jobId' | 'isAdminOrManager'>;

/** Adds read items to the picker; an item read again replaces its older entry. */
function mergePickerItems(
  current: InventoryPickerOption[],
  read: InventoryPickerOption[],
): InventoryPickerOption[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of read) merged.set(item.id, item);
  return Array.from(merged.values());
}

/** The catalog entry of one item, for a line whose item the loaded page lacks. */
async function readTargetedPickerItem(
  itemId: string,
  { jobId, isAdminOrManager }: CatalogReader,
): Promise<InventoryPickerOption | undefined> {
  const targeted =
    isAdminOrManager || !jobId
      ? await readInBackground('inventory-picker-page', { search: '', exactItemId: itemId })
      : await readInBackground('job-inventory-picker-options', {
          jobId,
          search: '',
          exactItemId: itemId,
        });
  return targeted.success ? targeted.items[0] : undefined;
}

type PickerOptions = { items: InventoryPickerOption[]; locations: InventoryLocation[] };

/** A field worker's picker: the assigned job's first catalog page, read when the dialog opens. */
async function loadFieldPickerOptions(
  jobId: string,
  {
    loadedFieldSearches,
    setIsPickerLoading,
    setSectionError,
    setPickerItems,
    setPickerLocations,
  }: {
    /** The search texts already read for this job, so a search does not read them again. */
    loadedFieldSearches: Set<string>;
    setIsPickerLoading: (loading: boolean) => void;
    setSectionError: (error: string | null) => void;
    setPickerItems: (items: InventoryPickerOption[]) => void;
    setPickerLocations: (locations: InventoryLocation[]) => void;
  },
): Promise<PickerOptions | null> {
  setIsPickerLoading(true);
  try {
    loadedFieldSearches.clear();
    const result = await readInBackground('job-inventory-picker-options', { jobId, search: '' });
    if (!result.success) {
      setSectionError('Material und Lagerorte konnten nicht geladen werden. Bitte versuche es erneut.');
      return null;
    }
    setPickerItems(result.items);
    setPickerLocations(result.locations);
    loadedFieldSearches.add('');
    return result;
  } finally {
    setIsPickerLoading(false);
  }
}

/**
 * For the office, a refresh brings new server props (stock after a booking,
 * a new location): they replace the matching picker entries and keep items
 * merged from searches. A field worker's picker loads on open instead, and
 * their props are fresh empty arrays on every render.
 */
function usePickerPropSync({
  isAdminOrManager,
  inventoryItems,
  locations,
  setPickerItems,
  setPickerLocations,
}: Omit<JobMaterialDialogOptions, 'jobId'> & {
  setPickerItems: Dispatch<SetStateAction<InventoryPickerOption[]>>;
  setPickerLocations: Dispatch<SetStateAction<InventoryLocation[]>>;
}): void {
  const [syncedInventoryItems, setSyncedInventoryItems] = useState(inventoryItems);
  const [syncedLocations, setSyncedLocations] = useState(locations);
  if (isAdminOrManager && inventoryItems !== syncedInventoryItems) {
    setSyncedInventoryItems(inventoryItems);
    setPickerItems((current) => mergePickerItems(current, inventoryItems));
  }
  if (isAdminOrManager && locations !== syncedLocations) {
    setSyncedLocations(locations);
    setPickerLocations(locations);
  }
}

type PickerCatalogOptions = JobMaterialDialogOptions & {
  /** The open dialog, whose search text the catalog reads for. */
  dialog: MaterialDialogState | null;
  setSectionError: (error: string | null) => void;
};

/** The picker's items and Lager, its loading state, and the server search with its retry. */
function usePickerCatalog({
  jobId,
  isAdminOrManager,
  inventoryItems,
  locations,
  dialog,
  setSectionError,
}: PickerCatalogOptions) {
  const [pickerItems, setPickerItems] = useState(inventoryItems);
  const [pickerLocations, setPickerLocations] = useState(locations);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const loadedFieldSearchesRef = useRef(new Set<string>());
  const [failedSearchKey, setFailedSearchKey] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  usePickerPropSync({ isAdminOrManager, inventoryItems, locations, setPickerItems, setPickerLocations });

  async function loadPickerOptions(): Promise<PickerOptions | null> {
    if (isAdminOrManager || !jobId) {
      return { items: pickerItems, locations: pickerLocations };
    }
    return loadFieldPickerOptions(jobId, {
      loadedFieldSearches: loadedFieldSearchesRef.current,
      setIsPickerLoading,
      setSectionError,
      setPickerItems,
      setPickerLocations,
    });
  }

  const fieldSearch = dialog?.search.trim() ?? '';
  const isDialogOpen = dialog !== null;
  // The picker holds one page; a search asks the server for the rest of the
  // catalog. The office searches the organization, a worker the assigned job.
  useEffect(() => {
    if ((!isAdminOrManager && !jobId) || !isDialogOpen || fieldSearch.length < 2) return;
    const searchKey = normalizeSearchText(fieldSearch);
    if (loadedFieldSearchesRef.current.has(searchKey)) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsPickerLoading(true);
      try {
        const result =
          isAdminOrManager || !jobId
            ? await readInBackground('inventory-picker-page', { search: fieldSearch }, controller.signal)
            : await readInBackground(
                'job-inventory-picker-options',
                { jobId, search: fieldSearch },
                controller.signal,
              );
        if (controller.signal.aborted) return;
        if (!result.success) {
          setFailedSearchKey(searchKey);
          return;
        }
        loadedFieldSearchesRef.current.add(searchKey);
        setPickerItems((current) => mergePickerItems(current, result.items));
        setPickerLocations(result.locations);
      } finally {
        if (!controller.signal.aborted) setIsPickerLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setIsPickerLoading(false);
    };
  }, [fieldSearch, isAdminOrManager, isDialogOpen, jobId, searchAttempt]);
  // The failure belongs to the text it was read for; another text reads anew.
  const searchFailed = failedSearchKey !== null && failedSearchKey === normalizeSearchText(fieldSearch);
  function retrySearch(): void {
    setFailedSearchKey(null);
    setSearchAttempt((attempt) => attempt + 1);
  }

  return {
    pickerItems,
    setPickerItems,
    pickerLocations,
    isPickerLoading,
    searchFailed,
    retrySearch,
    loadPickerOptions,
  };
}

/**
 * The material dialog's open state and the catalog it picks from: the first
 * page arrives with the section, a field worker loads it on open, and a
 * search reads further items from the server.
 */
export function useJobMaterialDialog({
  jobId,
  isAdminOrManager,
  inventoryItems,
  locations,
}: JobMaterialDialogOptions): JobMaterialDialog {
  const [dialog, setDialog] = useState<MaterialDialogState | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const catalog = usePickerCatalog({
    jobId,
    isAdminOrManager,
    inventoryItems,
    locations,
    dialog,
    setSectionError,
  });

  async function openDialog(mode: MaterialDialogMode, line?: JobMaterialLine) {
    setSectionError(null);
    const picker = await catalog.loadPickerOptions();
    if (!picker) return;

    if (line) {
      let item = picker.items.find((entry) => entry.id === line.itemId);
      if (!item && (jobId || isAdminOrManager)) {
        const targetedItem = await readTargetedPickerItem(line.itemId, { jobId, isAdminOrManager });
        if (targetedItem) {
          item = targetedItem;
          catalog.setPickerItems((current) => [
            ...current.filter((entry) => entry.id !== targetedItem.id),
            targetedItem,
          ]);
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

  return {
    dialog,
    setDialog,
    sectionError,
    pickerItems: catalog.pickerItems,
    pickerLocations: catalog.pickerLocations,
    isPickerLoading: catalog.isPickerLoading,
    searchFailed: catalog.searchFailed,
    retrySearch: catalog.retrySearch,
    openDialog,
  };
}
