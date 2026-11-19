'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { setAsideShownStop } from '@/lib/field-sync/device/clock-device';
import { storedClockRecord } from '@/lib/field-sync/device/kept-clock-actions';
import type { SetAsideClockRecord, UnsentTimeEvent } from '@/lib/field-sync/device/time-outbox';
import { logError } from '@/lib/logging';
import { formatBerlinDateTime } from '@/lib/utils';

// The way on from a clock record this app version cannot read, besides deleting it (decision record
// 0010, "an unreadable clock record set aside"): the person sets it aside, so their later taps go
// again, and can copy it for support. A set-aside record stays on the phone, is never sent, and its
// time is settled through the correction.

const STILL_SENDING =
  'Diese Stempelzeit wird gerade noch gesendet. Warte einen Moment und versuche es dann erneut.';
const COPY_FAILED = 'Die Stempelzeit konnte nicht kopiert werden. Bitte versuche es erneut.';

/**
 * Copies an unreadable or set-aside record to the clipboard as it is stored, for the person to hand
 * to support: its key and its record, which hold ids and times, no names. Answers whether it was copied.
 */
async function copyForSupport(key: string): Promise<boolean> {
  const record = storedClockRecord(key);
  if (record === null) return false;
  try {
    await navigator.clipboard.writeText(`${key}\n${record}`);
    return true;
  } catch (failure) {
    logError('clock outbox: copy for support failed', failure);
    return false;
  }
}

/**
 * Copies a record for support: its button is pending while the clipboard writes, says „Kopiert“ for
 * a moment after, and a failure shows under the buttons.
 */
export function useCopyForSupport() {
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function copy(key: string): Promise<void> {
    setError(null);
    setCopying(key);
    try {
      if (!(await copyForSupport(key))) {
        setError(COPY_FAILED);
        return;
      }
    } finally {
      setCopying(null);
    }
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
  }
  return { copy, copying, copied, error };
}

type CopyForSupport = ReturnType<typeof useCopyForSupport>;

/** „Für den Support kopieren“ for the record under `recordKey`; it says „Kopiert“ for a moment after it copied. */
function CopyButton({ recordKey, support }: { recordKey: string; support: CopyForSupport }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11"
      pending={support.copying === recordKey}
      onClick={() => void support.copy(recordKey)}
    >
      {support.copied === recordKey ? 'Kopiert' : 'Für den Support kopieren'}
    </Button>
  );
}

/** The panel's runner of one outbox action; a task's answered sentence shows instead of a success. */
type Perform = (id: string, task: () => Promise<string | undefined>) => Promise<boolean>;

/** The choices of an unreadable stop besides „Löschen“: set it aside, or copy it for support. */
export function UnreadableStopActions({
  stopKey,
  running,
  busy,
  perform,
  support,
}: {
  /** The key of the stop the person was shown, the chain's first row. */
  stopKey: string;
  running: string | null;
  busy: boolean;
  perform: Perform;
  support: CopyForSupport;
}) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        pending={running === 'aside'}
        disabled={busy}
        onClick={() =>
          void perform('aside', async () =>
            (await setAsideShownStop(stopKey)) === 'sending' ? STILL_SENDING : undefined,
          )
        }
      >
        Beiseitelegen
      </Button>
      <CopyButton recordKey={stopKey} support={support} />
    </>
  );
}

/** A set-aside record as a row of the deletion question: its key is the id the deletion removes. */
function setAsideRow({ key, capturedAt }: SetAsideClockRecord): UnsentTimeEvent {
  return {
    operationId: key,
    capturedAt,
    action: 'switch',
    selection: null,
    expected: null,
    status: 'unreadable',
    code: null,
  };
}

/** What the set-aside records are and what the person does about them, for `count` records. */
function setAsideSentence(count: number): string {
  return count === 1
    ? 'Diese App-Version kann diese Stempelzeit nicht lesen, und sie wird nicht übertragen. Prüfe deine Zeiterfassung und beantrage bei Bedarf eine Zeitkorrektur. Für eine Rückfrage beim Support kannst du sie kopieren.'
    : 'Diese App-Version kann diese Stempelzeiten nicht lesen, und sie werden nicht übertragen. Prüfe deine Zeiterfassung und beantrage bei Bedarf eine Zeitkorrektur. Für eine Rückfrage beim Support kannst du sie kopieren.';
}

/**
 * The records the person set aside: they stay on the phone, are never sent, and the person settles
 * their time through a correction. Each can be copied for support or deleted. Nothing without one.
 */
export function SetAsideRecords({
  records,
  busy,
  support,
  onDelete,
}: {
  records: readonly SetAsideClockRecord[];
  busy: boolean;
  support: CopyForSupport;
  /** Opens the deletion question for exactly this record. */
  onDelete: (rows: UnsentTimeEvent[]) => void;
}) {
  if (records.length === 0) return null;
  return (
    <div className="space-y-2" data-clock-set-aside="">
      <p className="text-sm text-muted-foreground">{setAsideSentence(records.length)}</p>
      <ul className="divide-y rounded-md border" aria-label="Beiseitegelegte Stempelzeiten">
        {records.map((record) => (
          <li key={record.key} className="space-y-2 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 font-medium">Nicht lesbare Stempelzeit</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatBerlinDateTime(record.capturedAt)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyButton recordKey={record.key} support={support} />
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 text-destructive"
                disabled={busy}
                onClick={() => onDelete([setAsideRow(record)])}
              >
                Löschen
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
