'use client';

import { useState } from 'react';
import { Undo2, Wrench } from 'lucide-react';

import { usePageAction } from '@/components/shared/page-action';
import { ListPagination } from '@/components/shared/list-pagination';
import { useBanner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { RefreshButton } from '@/components/ui/refresh-button';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import {
  addLeistungPrice,
  createLeistung,
  setLeistungArchived,
  updateLeistung,
} from '@/lib/price-catalog/actions';
import {
  leistungListViewSchema,
  type LeistungListQuery,
  type LeistungListView,
  type LeistungPage,
} from '@/lib/price-catalog/list-page';
import type { LeistungListEntry } from '@/lib/price-catalog/types';
import { LeistungDialog, type LeistungDialogSubmit } from './leistung-dialog';
import {
  LEISTUNG_FAILURE_MESSAGES,
  leistungFieldsInput,
  leistungPriceInput,
  type LeistungPriceForm,
} from './leistung-form-state';
import { LeistungPriceDialog } from './leistung-price-dialog';
import { LeistungenCards, LeistungenTable, type LeistungRowActions } from './leistungen-table';

type OpenDialog = { kind: 'edit' | 'prices'; leistungId: string } | null;

/** The view switch, the search and the refresh; stacks on phones. */
function LeistungenToolbar({
  view,
  search,
  onViewChange,
  onSearchChange,
}: {
  view: LeistungListView;
  search: string;
  onViewChange: (view: LeistungListView) => void;
  onSearchChange: (search: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Select
        value={view}
        onValueChange={(value) => {
          const parsed = leistungListViewSchema.safeParse(value);
          if (parsed.success) onViewChange(parsed.data);
        }}
      >
        <SelectTrigger className="h-8 w-full sm:w-48" aria-label="Leistungen anzeigen">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="aktiv">Aktive Leistungen</SelectItem>
          <SelectItem value="archiviert">Archivierte</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
        <SearchInput
          wrapperClassName="min-w-0 flex-1 sm:max-w-xs"
          value={search}
          onValueChange={onSearchChange}
          className="h-8"
          placeholder="Nummer, Name, Beschreibung…"
          aria-label="Leistungen durchsuchen"
        />
        <RefreshButton label="Liste aktualisieren" />
      </div>
    </div>
  );
}

/**
 * The writes of the list. Each action revalidates the route, so its response
 * carries the new page; a changed row stays marked until those props land.
 */
function useLeistungWrites(entries: readonly LeistungListEntry[]) {
  const { showBanner } = useBanner();
  const settle = useSettleOnChange(entries);
  const { run: runBusy, isBusy } = useBusyIds();

  const settled = async (rowId: string, write: () => Promise<ActionResult>): Promise<ActionResult> => {
    const since = settle.markChange();
    const result = await write();
    if (result.success) void runBusy(rowId, () => settle(since));
    return result;
  };

  const submitDialog = async (submit: LeistungDialogSubmit): Promise<ActionResult> => {
    const fields = leistungFieldsInput(submit.fields);
    if (submit.mode === 'edit') {
      const result = await settled(submit.leistungId, () =>
        updateLeistung({ ...fields, leistungId: submit.leistungId }),
      );
      if (result.success)
        showBanner({ variant: 'success', message: `Leistung „${fields.name.trim()}“ gespeichert.` });
      return result;
    }
    const result = await createLeistung({ ...fields, ...leistungPriceInput(submit.price) });
    if (result.success)
      showBanner({ variant: 'success', message: `Leistung „${fields.name.trim()}“ angelegt.` });
    return result;
  };

  const addPrice = async (leistungId: string, price: LeistungPriceForm): Promise<ActionResult> => {
    const result = await settled(leistungId, () =>
      addLeistungPrice({ leistungId, ...leistungPriceInput(price) }),
    );
    if (result.success) showBanner({ variant: 'success', message: 'Neuer Preis gespeichert.' });
    return result;
  };

  const setArchived = (entry: LeistungListEntry, archived: boolean): void => {
    void runBusy(entry.id, async () => {
      const since = settle.markChange();
      const result = await setLeistungArchived({ leistungId: entry.id, archived }).catch(() => null);
      if (!result?.success) {
        const reason = result
          ? describeFailure(result.error, LEISTUNG_FAILURE_MESSAGES, 'Bitte versuche es erneut.')
          : 'Bitte versuche es erneut.';
        showBanner({ variant: 'error', message: `„${entry.name}“ konnte nicht geändert werden: ${reason}` });
        return;
      }
      showBanner({
        variant: 'success',
        message: archived ? `„${entry.name}“ archiviert.` : `„${entry.name}“ wiederhergestellt.`,
        actionLabel: 'Rückgängig',
        actionIcon: <Undo2 className="size-4" />,
        onAction: () => setArchived(entry, !archived),
      });
      await settle(since);
    });
  };

  return { submitDialog, addPrice, setArchived, isBusy };
}

/**
 * The server selects the page: view, search and count apply in the database
 * before the page boundary, and the URL owns that state.
 */
export function LeistungenContent({
  entries,
  total,
  hasAnyLeistung,
  priceDate,
  query,
}: LeistungPage & { query: LeistungListQuery }) {
  const navigation = useListNavigation();
  // The typed text and the chosen view stay ahead of the URL while the read is under way.
  const [search, setSearch] = useState(query.search);
  const [view, setView] = useState(query.view);
  const shownSearch = navigation.busy ? search : query.search;
  const shownView = navigation.busy ? view : query.view;
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const writes = useLeistungWrites(entries);
  const actions: LeistungRowActions = {
    onOpenPrices: (entry) => setOpenDialog({ kind: 'prices', leistungId: entry.id }),
    onEdit: (entry) => setOpenDialog({ kind: 'edit', leistungId: entry.id }),
    onSetArchived: writes.setArchived,
    isBusy: writes.isBusy,
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        <LeistungenToolbar
          view={shownView}
          search={shownSearch}
          onViewChange={(value) => {
            setSearch(shownSearch);
            setView(value);
            navigation.navigate({ ansicht: value === 'aktiv' ? null : value, page: 1 });
          }}
          onSearchChange={(value) => {
            setView(shownView);
            setSearch(value);
            navigation.navigate({ q: value, page: 1 }, 250);
          }}
        />
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? 'Leistung' : 'Leistungen'}
        </p>
      </div>
      {entries.length === 0 ? (
        <LeistungenEmpty hasAnyLeistung={hasAnyLeistung} query={query} />
      ) : (
        <>
          <LeistungenCards entries={entries} actions={actions} />
          <LeistungenTable entries={entries} actions={actions} />
        </>
      )}
      <ListPagination
        label="Leistungen"
        page={query.page}
        total={total}
        busy={navigation.busy}
        onPageChange={(page) => navigation.navigate({ page })}
      />
      <LeistungDialogs
        openDialog={openDialog}
        entries={entries}
        priceDate={priceDate}
        writes={writes}
        onClose={() => setOpenDialog(null)}
      />
    </>
  );
}

/** The create dialog the header button opens, and the edit or price dialog of one row. */
function LeistungDialogs({
  openDialog,
  entries,
  priceDate,
  writes,
  onClose,
}: {
  openDialog: OpenDialog;
  entries: readonly LeistungListEntry[];
  priceDate: string;
  writes: Pick<ReturnType<typeof useLeistungWrites>, 'submitDialog' | 'addPrice'>;
  onClose: () => void;
}) {
  const createDialog = usePageAction();
  const entry = openDialog ? entries.find((candidate) => candidate.id === openDialog.leistungId) : undefined;
  return (
    <>
      {createDialog.open && (
        <LeistungDialog
          entry={null}
          onClose={() => createDialog.setOpen(false)}
          onSubmit={writes.submitDialog}
        />
      )}
      {openDialog?.kind === 'edit' && entry && (
        <LeistungDialog entry={entry} onClose={onClose} onSubmit={writes.submitDialog} />
      )}
      {openDialog?.kind === 'prices' && entry && (
        <LeistungPriceDialog
          entry={entry}
          priceDate={priceDate}
          onClose={onClose}
          onAddPrice={writes.addPrice}
        />
      )}
    </>
  );
}

function LeistungenEmpty({ hasAnyLeistung, query }: { hasAnyLeistung: boolean; query: LeistungListQuery }) {
  if (!hasAnyLeistung) {
    return (
      <EmptyState
        icon={Wrench}
        title="Noch keine Leistungen"
        description="Lege Arbeitszeit, Anfahrt oder Pauschalen mit ihrem Preis über „Leistung anlegen“ an."
      />
    );
  }
  return (
    <EmptyState
      icon={Wrench}
      title="Keine Leistungen gefunden"
      description={
        query.view === 'archiviert' && !query.search
          ? 'Es gibt keine archivierte Leistung.'
          : 'Zu der Suche gibt es keine Leistung. Ändere die Suche oder die Ansicht.'
      }
    />
  );
}
