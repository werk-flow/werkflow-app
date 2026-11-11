'use client';

import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { useBusyIds } from '@/hooks/use-busy-id';
import type { StoredDraft } from '@/lib/field-sync/device/draft-store';
import type { DraftSendProgress } from '@/lib/field-sync/device/draft-sync';
import { logError } from '@/lib/logging';
import { formatBerlin } from '@/lib/utils';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';
import type { DeviceDrafts, DraftDevice } from './use-device-drafts';

/** What a draft on the device shows as. */
type DeviceDraftState =
  | { name: 'on_device' }
  | { name: 'sending'; uploaded: number; total: number }
  | { name: 'not_sent' }
  | { name: 'no_access' };

function draftState(
  draft: StoredDraft,
  progress: DraftSendProgress | null,
  pastLimit: boolean,
): DeviceDraftState {
  if (draft.refusal?.kind === 'no_access') return { name: 'no_access' };
  if (progress?.draftId === draft.id)
    return { name: 'sending', uploaded: progress.uploaded, total: progress.total };
  if (draft.refusal !== null || pastLimit) return { name: 'not_sent' };
  return { name: 'on_device' };
}

function stateLabel(state: DeviceDraftState): string {
  switch (state.name) {
    case 'on_device':
      return 'Entwurf auf dem Gerät';
    case 'sending':
      return state.total > 0
        ? `Wird hochgeladen (${state.uploaded} von ${state.total} Fotos)`
        : 'Wird übertragen …';
    case 'not_sent':
      return 'Nicht übertragen';
    case 'no_access':
      return 'Kein Zugriff mehr';
  }
}

/** One sentence that says what happens to the draft next, or what the person can do. */
function stateHint(row: DraftRow, noAccessKeptMs: number): string | null {
  const { draft, state, pastLimit } = row;
  switch (state.name) {
    case 'on_device':
      return draft.ready
        ? 'Wird übertragen, sobald du wieder Netz hast.'
        : 'Noch unvollständig. Öffne den Entwurf und ergänze die markierten Felder.';
    case 'sending':
      return null;
    case 'not_sent':
      return pastLimit && draft.refusal === null
        ? 'Seit über 7 Tagen nicht übertragen. Sende den Entwurf erneut oder lösche ihn.'
        : 'Der Entwurf konnte nicht übertragen werden. Sende ihn erneut oder lösche ihn.';
    case 'no_access': {
      const until = new Date(Date.parse(draft.refusal?.at ?? '') + noAccessKeptMs);
      return `Du hast keinen Zugriff mehr auf diesen Auftrag. Der Entwurf wird nicht übertragen und am ${formatBerlin(until, 'date')} von diesem Gerät gelöscht.`;
    }
  }
}

type DraftRow = {
  draft: StoredDraft;
  state: DeviceDraftState;
  /** Whether the draft belongs to the job of this page. */
  here: boolean;
  pastLimit: boolean;
};

/** The drafts this page lists: its own job's, and those of other jobs that wait for the person's decision. */
function draftRows(deviceDrafts: DeviceDrafts, device: DraftDevice, jobId: string | null): DraftRow[] {
  return deviceDrafts.drafts.flatMap((draft) => {
    const pastLimit = device.isPastUnsentLimit(draft);
    const state = draftState(draft, deviceDrafts.progress, pastLimit);
    const here = draft.jobId === jobId;
    return here || state.name === 'not_sent' || state.name === 'no_access'
      ? [{ draft, state, here, pastLimit }]
      : [];
  });
}

type DeviceDraftListProps = {
  deviceDrafts: DeviceDrafts;
  /** The job of this page: its drafts can be opened; drafts of other jobs show only when the person must decide. */
  jobId: string | null;
  onOpen: (draft: StoredDraft) => void;
};

/**
 * The report drafts this device keeps: what waits, what is being uploaded, what the server did
 * not take and what the person lost access to. Nothing renders while the device holds none.
 */
export function DeviceDraftList({ deviceDrafts, jobId, onOpen }: DeviceDraftListProps) {
  const { device, failure } = deviceDrafts;
  const { run, isBusy, anyBusy } = useBusyIds();
  const [deleting, setDeleting] = useState<StoredDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (failure) return <SectionError className="mt-4" failure={failure} />;
  if (!device) return null;
  const rows = draftRows(deviceDrafts, device, jobId);
  if (rows.length === 0) return null;

  function send(draft: StoredDraft) {
    if (!device) return;
    setError(null);
    void run(draft.id, async () => {
      try {
        const outcome = await device.send(draft.id);
        if (outcome === 'waiting')
          setError('Gerade kein Netz. Der Entwurf bleibt auf dem Gerät und wird später übertragen.');
        else if (outcome === 'refused')
          setError('Der Entwurf konnte nicht übertragen werden. Er bleibt auf diesem Gerät.');
      } catch (failed) {
        logError('DeviceDraftList: send failed', failed);
        setError('Der Entwurf konnte auf diesem Gerät nicht gelesen werden. Bitte versuch es noch einmal.');
      }
    });
  }

  return (
    <div className="mt-4 space-y-2" data-testid="device-drafts">
      <p className="text-sm font-medium">Auf diesem Gerät</p>
      <ul className="divide-y rounded-md border">
        {rows.map((row) => (
          <DeviceDraftRow
            key={row.draft.id}
            row={row}
            hint={stateHint(row, device.noAccessKeptMs)}
            sending={isBusy(row.draft.id)}
            disabled={anyBusy}
            onOpen={() => onOpen(row.draft)}
            onSend={() => send(row.draft)}
            onDelete={() => setDeleting(row.draft)}
          />
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
      <DeviceDraftDeleteDialog
        draft={deleting}
        onClose={() => setDeleting(null)}
        onDelete={async (draft) => {
          await device.change(draft.id, () => null);
          device.changed();
        }}
      />
    </div>
  );
}

/** One draft: its title, state and what the person can do with it now. */
function DeviceDraftRow({
  row,
  hint,
  sending,
  disabled,
  onOpen,
  onSend,
  onDelete,
}: {
  row: DraftRow;
  hint: string | null;
  sending: boolean;
  disabled: boolean;
  onOpen: () => void;
  onSend: () => void;
  onDelete: () => void;
}) {
  const { draft, state, here } = row;
  const photoCount = draft.photos.length;
  return (
    <li data-draft-id={draft.id} className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{draft.title.trim() || 'Ohne Titel'}</p>
          <p className="text-xs text-muted-foreground">
            {WORK_ARTIFACT_KIND_LABELS[draft.kind]}
            {photoCount > 0 && ` · ${photoCount} ${photoCount === 1 ? 'Foto' : 'Fotos'}`}
            {!here && ' · anderer Auftrag'}
          </p>
        </div>
        <Badge variant={state.name === 'not_sent' ? 'destructive' : 'outline'}>{stateLabel(state)}</Badge>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {state.name !== 'sending' && (
        <div className="flex flex-wrap gap-2">
          {here && !draft.sealed && state.name !== 'no_access' && (
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onOpen}>
              Bearbeiten
            </Button>
          )}
          {state.name !== 'no_access' && draft.ready && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              pending={sending}
              disabled={disabled}
              onClick={onSend}
            >
              {state.name === 'not_sent' ? 'Erneut senden' : 'Jetzt senden'}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onDelete}>
            Löschen
          </Button>
        </div>
      )}
    </li>
  );
}

/** The confirmation before a draft and its photos leave the device for good. */
function DeviceDraftDeleteDialog({
  draft,
  onClose,
  onDelete,
}: {
  draft: StoredDraft | null;
  onClose: () => void;
  onDelete: (draft: StoredDraft) => Promise<void>;
}) {
  const { run, anyBusy } = useBusyIds();
  const [error, setError] = useState<string | null>(null);

  function remove(target: StoredDraft) {
    void run('delete', async () => {
      try {
        await onDelete(target);
        onClose();
      } catch (failed) {
        logError('DeviceDraftDeleteDialog: delete failed', failed);
        setError('Der Entwurf konnte nicht gelöscht werden. Bitte versuch es noch einmal.');
      }
    });
  }

  return (
    <AlertDialog
      open={draft !== null}
      pending={anyBusy}
      onOpenChange={(open) => {
        if (open) return;
        setError(null);
        onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Entwurf „{draft?.title.trim() || 'Ohne Titel'}“ löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Der Entwurf und seine Fotos sind nur auf diesem Gerät gespeichert. Nach dem Löschen sind sie nicht
            wiederherstellbar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter error={error}>
          <AlertDialogCancel disabled={anyBusy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            pending={anyBusy}
            onClick={(event) => {
              // The primitive closes on click; stay open until the device answered.
              event.preventDefault();
              if (draft) remove(draft);
            }}
          >
            Endgültig löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
