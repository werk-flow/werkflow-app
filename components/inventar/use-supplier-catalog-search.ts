'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { readInBackground } from '@/lib/data/background-read-client';
import { adoptSupplierCatalogArticle } from '@/lib/inventory/supplier-catalog-actions';
import type { InventoryLocation, InventoryPickerOption } from '@/lib/inventory/types';
import {
  SUPPLIER_CATALOG_SEARCH_MIN_LENGTH,
  type SupplierCatalogOption,
} from '@/lib/inventory/wholesaler-import-schemas';
import { normalizeSearchText } from '@/lib/ui/search';
import { addItemToDialogRows, type MaterialDialogState } from './job-material-dialog-model';

/** The imported wholesaler catalogs below the own articles, for the office planning material. */
export type SupplierCatalogPicker = {
  /** Whether the search text is long enough for the catalog search. */
  searched: boolean;
  options: SupplierCatalogOption[];
  /** More rows match than the search shows. */
  hasMore: boolean;
  isSearching: boolean;
  searchFailed: boolean;
  retrySearch: () => void;
  /** The catalog row being made an own article, shown pending at once. */
  adoptingId: string | null;
  adoptFailure: string | null;
  adopt: (option: SupplierCatalogOption) => void;
};

type SetDialog = Dispatch<SetStateAction<MaterialDialogState | null>>;
/** The picker's catalog an adopted article joins. */
type PickerCatalog = {
  setPickerItems: Dispatch<SetStateAction<InventoryPickerOption[]>>;
  pickerLocations: InventoryLocation[];
};

const ADOPT_ERRORS: Record<string, string> = {
  item_archived:
    'Zu dieser Artikelnummer gibt es einen archivierten eigenen Artikel. Stelle ihn im Inventar wieder her.',
  catalog_article_not_found: 'Diesen Katalogartikel gibt es nicht mehr. Suche noch einmal.',
};

/** The catalog rows for one search text, read after a pause in typing; a failure belongs to its text. */
function useCatalogSearchResult(searched: boolean, search: string) {
  const searchKey = searched ? normalizeSearchText(search) : '';
  const [result, setResult] = useState<{
    key: string;
    options: SupplierCatalogOption[];
    hasMore: boolean;
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!searched) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingKey(searchKey);
      try {
        const read = await readInBackground('supplier-catalog-search', { search }, controller.signal);
        if (controller.signal.aborted) return;
        if (!read.success) return setFailedKey(searchKey);
        setFailedKey(null);
        setResult({ key: searchKey, options: read.options, hasMore: read.hasMore });
      } finally {
        if (!controller.signal.aborted) setLoadingKey(null);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setLoadingKey(null);
    };
  }, [searched, searchKey, search, attempt]);

  return {
    options: searched && result?.key === searchKey ? result.options : [],
    hasMore: searched && result?.key === searchKey && result.hasMore,
    // Until the first answer for this text arrives, the search counts as running.
    isSearching:
      searched && (loadingKey === searchKey || (result?.key !== searchKey && failedKey !== searchKey)),
    searchFailed: searched && failedKey === searchKey,
    retrySearch: () => {
      setFailedKey(null);
      setAttempt((count) => count + 1);
    },
  };
}

/** Makes a catalog row an own article and adds it to the open dialog's positions. */
function useCatalogAdopt(dialogOpen: boolean, setDialog: SetDialog, picker: PickerCatalog) {
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const [adoptFailure, setAdoptFailure] = useState<string | null>(null);
  // A reopened dialog starts without the last dialog's failure.
  const [seenOpen, setSeenOpen] = useState(dialogOpen);
  if (dialogOpen !== seenOpen) {
    setSeenOpen(dialogOpen);
    if (dialogOpen) setAdoptFailure(null);
  }
  const { run } = usePendingTask();
  // Counts each opening of the material dialog, so an adopt joins only the dialog it started in.
  // A layout effect runs inside the commit that opens the dialog, before any awaited answer lands.
  const dialogSession = useRef(0);
  useLayoutEffect(() => {
    if (dialogOpen) dialogSession.current += 1;
  }, [dialogOpen]);

  function adopt(option: SupplierCatalogOption): void {
    setAdoptFailure(null);
    setAdoptingId(option.id);
    const session = dialogSession.current;
    void run(async () => {
      try {
        const adopted = await adoptSupplierCatalogArticle({ catalogArticleId: option.id }).catch(() => null);
        if (!adopted?.success) {
          return setAdoptFailure(
            (adopted && ADOPT_ERRORS[adopted.error]) ??
              'Der Katalogartikel konnte nicht übernommen werden. Versuch es noch einmal.',
          );
        }
        const { item } = adopted;
        picker.setPickerItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
        if (session !== dialogSession.current) return;
        setDialog((current) =>
          current
            ? {
                ...current,
                rows: addItemToDialogRows(current.rows, item, {
                  locations: picker.pickerLocations,
                  mode: current.mode,
                  canAddMultiple: current.mode === 'plan' || current.mode === 'take',
                }),
                error: null,
              }
            : current,
        );
      } finally {
        setAdoptingId(null);
      }
    });
  }

  return { adoptingId, adoptFailure, adopt };
}

/**
 * Searches the supplier catalogs while the office plans material, and makes
 * a chosen catalog row an own article that joins the dialog's positions. A
 * field worker gets nothing: the search and the action refuse them too.
 */
export function useSupplierCatalogSearch({
  enabled,
  dialog,
  setDialog,
  picker,
}: {
  enabled: boolean;
  dialog: MaterialDialogState | null;
  setDialog: SetDialog;
  picker: PickerCatalog;
}): SupplierCatalogPicker | null {
  const search = dialog?.search.trim() ?? '';
  const searched = enabled && dialog?.mode === 'plan' && search.length >= SUPPLIER_CATALOG_SEARCH_MIN_LENGTH;
  const result = useCatalogSearchResult(searched, search);
  const adoption = useCatalogAdopt(dialog !== null, setDialog, picker);
  return enabled ? { searched, ...result, ...adoption } : null;
}
