'use client';

import { Fragment, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { JobPickerRadioMark } from '@/components/job-picker-modal-options';
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
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { PlainButton } from '@/components/ui/plain-button';
import { SearchInput } from '@/components/ui/search-input';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useReportPending } from '@/hooks/use-report-pending';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { attachRequestToWork } from '@/lib/requests/attach-actions';
import { WORK_TARGET_KIND_LABELS, workTargetHref, type RequestWorkTarget } from '@/lib/requests/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { cn } from '@/lib/utils';
import { useAttemptKey } from './use-attempt-key';
import { useRequestWorkTargets } from './use-request-work-targets';

const WORK_LIST_ID = 'attach-request-work';
const WORK_REQUIRED_MESSAGE = 'Wähl die Arbeit aus, zu der die Anfrage gehört.';

const ATTACH_ERROR_MESSAGES = {
  already_attached: 'Diese Anfrage wurde schon zu anderer Arbeit hinzugefügt.',
  request_not_editable: 'Die Anfrage ist nicht mehr offen. Lade die Seite neu.',
  client_required: 'Ordne der Anfrage zuerst einen Kunden zu.',
  work_not_found: 'Diese Arbeit gibt es nicht mehr. Wähl eine andere.',
  work_client_mismatch: 'Diese Arbeit gehört zu einem anderen Kunden. Wähl eine andere.',
  work_closed: 'Diese Arbeit ist inzwischen abgeschlossen. Wähl eine andere.',
} satisfies Record<string, string>;

/** „Auftrag A-51 · Lindenhof 1 · Lindenstraße 1, 10115 Berlin“ */
function targetLine(target: RequestWorkTarget): string {
  const kind = WORK_TARGET_KIND_LABELS[target.kind];
  return [target.number ? `${kind} ${target.number}` : kind, target.siteLabel].filter(Boolean).join(' · ');
}

function WorkTargetLoadingRows() {
  return (
    <div className="space-y-0.5" role="status" aria-busy="true">
      <span className="sr-only">Offene Arbeit wird geladen.</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-48 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/** The customer's open work as one radio list, the request's site first. */
function WorkTargetList({
  targets,
  selectedId,
  onSelect,
  invalid,
}: {
  targets: RequestWorkTarget[];
  selectedId: string | null;
  onSelect: (target: RequestWorkTarget) => void;
  invalid: boolean;
}) {
  const atSiteCount = targets.filter((target) => target.atRequestSite).length;
  return (
    <div
      id={WORK_LIST_ID}
      tabIndex={-1}
      role="radiogroup"
      aria-label="Offene Arbeit des Kunden"
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${WORK_LIST_ID}-error` : undefined}
      className="space-y-0.5 rounded-lg outline-none"
    >
      {targets.map((target, index) => {
        const checked = selectedId === target.id;
        return (
          <Fragment key={target.id}>
            {atSiteCount > 0 && atSiteCount < targets.length && (index === 0 || index === atSiteCount) && (
              <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                {index === 0 ? 'Am Einsatzort der Anfrage' : 'Weitere offene Arbeit des Kunden'}
              </p>
            )}
            <PlainButton
              role="radio"
              aria-checked={checked}
              onClick={() => onSelect(target)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                checked ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent',
              )}
            >
              <JobPickerRadioMark checked={checked} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block break-words font-medium">{target.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{targetLine(target)}</span>
              </span>
            </PlainButton>
          </Fragment>
        );
      })}
    </div>
  );
}

/** The search, the list and its loading, failure, empty and overflow states. */
function WorkTargetPicker({
  requestId,
  selected,
  onSelect,
  invalid,
}: {
  requestId: string;
  selected: RequestWorkTarget | null;
  onSelect: (target: RequestWorkTarget) => void;
  invalid: boolean;
}) {
  const { search, setSearch, searchedQuery, targets, hasMore, loading, failure } =
    useRequestWorkTargets(requestId);
  return (
    <div className="space-y-3">
      <SearchInput
        value={search}
        onValueChange={setSearch}
        pending={loading && targets !== undefined}
        placeholder="Nummer, Titel oder Einsatzort…"
        aria-label="Offene Arbeit durchsuchen"
      />
      {failure ? (
        <SectionError failure={failure} />
      ) : targets === undefined ? (
        <WorkTargetLoadingRows />
      ) : targets.length === 0 ? (
        searchedQuery ? (
          <EmptyState
            size="compact"
            title="Keine offene Arbeit gefunden"
            description="Prüf die Schreibweise oder leere die Suche."
          />
        ) : (
          <EmptyState
            size="compact"
            title="Noch keine offene Arbeit bei diesem Kunden"
            description="Wandle die Anfrage stattdessen in neue Arbeit um."
          />
        )
      ) : (
        <>
          <WorkTargetList
            targets={targets}
            selectedId={selected?.id ?? null}
            onSelect={onSelect}
            invalid={invalid}
          />
          {hasMore && (
            <p className="px-3 text-xs text-muted-foreground">
              Es gibt weitere offene Arbeit. Grenz die Suche ein, um sie zu sehen.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The dialog's form: one opening, one attempt key; a retry after a lost answer returns the first entry. */
function AttachRequestForm({
  requestId,
  onClose,
  onSaved,
  onPendingChange,
}: {
  requestId: string;
  onClose: () => void;
  onSaved: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const attempt = useAttemptKey();
  const [selected, setSelected] = useState<RequestWorkTarget | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionError = attempted && !selected ? WORK_REQUIRED_MESSAGE : undefined;

  const { run, isPending } = useServerAction(async (target: RequestWorkTarget) => {
    setError(null);
    const result = await attachRequestToWork(
      requestId,
      { kind: target.kind, id: target.id },
      attempt.attemptKey,
    );
    if (!result.success) {
      setError(
        describeFailure(result.error, ATTACH_ERROR_MESSAGES, 'Die Anfrage konnte nicht hinzugefügt werden.'),
      );
      return;
    }
    const href = workTargetHref(target);
    const label = targetLine({ ...target, siteLabel: null });
    onClose();
    showBanner({
      variant: 'success',
      message: `Anfrage wurde zu ${label} hinzugefügt.`,
      actionLabel: 'Öffnen',
      onAction: () => router.push(href),
    });
    router.refresh();
    onSaved();
  });
  useReportPending(isPending, onPendingChange);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAttempted(true);
    if (!selected) {
      focusFirstInvalidField({ [WORK_LIST_ID]: WORK_REQUIRED_MESSAGE });
      return;
    }
    void run(selected);
  }

  return (
    <form onSubmit={submit} className="contents" noValidate>
      <DialogBody className="space-y-2 py-1">
        <WorkTargetPicker
          requestId={requestId}
          selected={selected}
          onSelect={(target) => {
            setSelected(target);
            setError(null);
          }}
          invalid={Boolean(selectionError)}
        />
        <ErrorText id={`${WORK_LIST_ID}-error`}>{selectionError}</ErrorText>
        <ErrorText>{error}</ErrorText>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
          Abbrechen
        </Button>
        <Button type="submit" pending={isPending} disabled={isPending}>
          Hinzufügen
        </Button>
      </DialogFooter>
    </form>
  );
}

interface AttachRequestDialogProps {
  requestId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after the server confirmed; the page marks itself until refreshed props land. */
  onSaved: () => void;
}

/** Attaches an open request with a customer to an open job, project or Servicefall of that customer. */
export function AttachRequestDialog({ requestId, open, onOpenChange, onSaved }: AttachRequestDialogProps) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={pending}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Zu bestehender Arbeit hinzufügen</DialogTitle>
          <DialogDescription>
            Anliegen und Beschreibung kommen in den Verlauf der gewählten Arbeit, Dokumente und Bilder werden
            dort mit verknüpft. Danach ist die Anfrage erledigt und lässt sich nicht mehr umwandeln.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AttachRequestForm
            requestId={requestId}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
            onPendingChange={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
