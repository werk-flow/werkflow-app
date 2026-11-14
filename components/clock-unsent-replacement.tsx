'use client';

import { useRef, useState, type ComponentProps } from 'react';

import { useClockState } from '@/components/clock-state-provider';
import { lazyDialog } from '@/components/shared/lazy-dialog';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { useClosedTimePeriods } from '@/components/zeiterfassung/use-closed-time-periods';
import { useReportPending } from '@/hooks/use-report-pending';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  replacedSegmentEnd,
  replacementWindow,
  type SessionReplacement,
} from '@/lib/field-sync/device/time-outbox-replacement';
import { logError } from '@/lib/logging';
import { deriveClockActions } from '@/lib/time-tracking/clock-actions';
import { getTimeEntries } from '@/lib/time-tracking/entry-read-actions';
import { transitionTimeActivity } from '@/lib/time-tracking/segment-actions';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { formatBerlin } from '@/lib/utils';

// The guided correction of a late chain whose session the server holds or held (decision record
// 0010, "a late chain of a session that still runs"): end the session online, then file the
// correction that replaces its recorded end with the captured one. The kept events leave the phone
// only once that correction is filed; every failure before keeps them and says what happened.

/** The existing correction form, loaded when the person reaches it: it is far larger than this flow. */
const ReplacementDialog = lazyDialog(() =>
  import('@/components/zeiterfassung/time-correction-dialog').then(({ TimeCorrectionDialog }) => {
    function SessionReplacementDialog(
      props: Omit<ComponentProps<typeof TimeCorrectionDialog>, 'open' | 'onOpenChange'> & {
        open: boolean;
        onOpenChange: (open: boolean) => void;
      },
    ) {
      return <TimeCorrectionDialog {...props} hideTrigger />;
    }
    return SessionReplacementDialog;
  }),
);

const KEPT = 'Deine Zeiten bleiben auf diesem Gerät.';
const END_FAILED = `Die laufende Zeiterfassung konnte nicht beendet werden. Prüfe deine Verbindung und versuche es erneut. ${KEPT}`;
const READ_FAILED = `Deine erfassten Zeiten konnten nicht geladen werden. Prüfe deine Verbindung und versuche es erneut. ${KEPT}`;
/** A request of another kind leaves the recorded end as it is, so the captured times are still needed. */
const NOT_REPLACED =
  'Deine Korrektur ändert nicht das Ende deiner Zeiterfassung, deshalb bleiben deine Zeiten auf diesem Gerät. Beantrage eine Korrektur des Endes, oder lösche die Zeiten hier, wenn sie nicht mehr gebraucht werden.';
const NOT_FOUND = `Die Zeiterfassung, die diese Zeiten ersetzen, wurde nicht gefunden. Notiere dir die Zeiten, lösche sie hier und beantrage die Korrektur unter Zeiterfassung. ${KEPT}`;

/**
 * The operation ids of the flow's end and recovery requests. A retry after a lost answer sends the
 * same request under the same id, so the server replays it instead of ending twice. A request at
 * another version is another operation: the server refuses a known id with a changed request.
 */
type OperationIds = {
  id: (action: 'end' | 'recover_end', version: number | null) => string;
  /** The server answered: the next attempt is a new decision, never a replay of that answer. */
  forget: () => void;
};

/**
 * Ends the session the chain expects, unless the server already ended it. A session the server moved
 * to recovery meanwhile ends through recovery. Answers whether it is ended.
 */
async function endSession(input: {
  organizationId: string;
  sessionId: string;
  version: number | null;
  operationIds: OperationIds;
}): Promise<boolean> {
  const ended = await transitionTimeActivity({
    organizationId: input.organizationId,
    operationId: input.operationIds.id('end', input.version),
    action: 'end',
    expectedSessionId: input.sessionId,
    expectedVersion: input.version,
    selection: null,
    acknowledgeLong: false,
  });
  if (!ended.success) return false;
  if (ended.outcome !== 'recovery_required') return ended.outcome === 'ended';
  const recovered = await transitionTimeActivity({
    organizationId: input.organizationId,
    operationId: input.operationIds.id('recover_end', ended.version),
    action: 'recover_end',
    expectedSessionId: input.sessionId,
    expectedVersion: ended.version,
    selection: null,
    acknowledgeLong: true,
  });
  return recovered.success && recovered.outcome === 'ended';
}

/** What the person reads about the replacement: what ending does, and which time the correction sets. */
function ReplacementIntro({ running, capturedEnd }: { running: boolean; capturedEnd: string }) {
  const end = formatBerlin(capturedEnd, 'weekdayDateTime');
  return (
    <p className="text-sm text-muted-foreground" data-clock-replacement>
      {running
        ? `Diese Zeiten gehören zu deiner Zeiterfassung, die noch läuft. Mit „Korrektur beantragen“ beendest du sie jetzt. Der Server trägt dabei die aktuelle Uhrzeit als Ende ein; deine Korrektur ersetzt dieses Ende durch deine erfasste Zeit (${end}).`
        : `Deine Korrektur ersetzt das Ende deiner Zeiterfassung durch deine erfasste Zeit (${end}).`}{' '}
      Bis du die Korrektur abschickst, bleiben die Zeiten auf diesem Gerät.
    </p>
  );
}

/** Where the steps before the form ended: the entry the form edits, or what failed. */
type Prepared = { entry: TimeEntry } | { error: string };

/**
 * Steps 1 and 2: ends the session while it still runs, then finds the entry the correction edits.
 * The clock reads the server again after an end, whatever its answer. A thrown failure (no signal)
 * names the step it happened in.
 */
async function prepareReplacement(input: {
  replacement: SessionReplacement;
  organizationId: string;
  userId: string;
  /** The running session's version, or null when the session no longer runs. */
  runningVersion: number | null | undefined;
  operationIds: OperationIds;
  refresh: () => Promise<void>;
}): Promise<Prepared> {
  const { replacement, organizationId } = input;
  let step: 'end' | 'read' = input.runningVersion === undefined ? 'read' : 'end';
  try {
    if (input.runningVersion !== undefined) {
      const ended = await endSession({
        organizationId,
        sessionId: replacement.sessionId,
        version: input.runningVersion,
        operationIds: input.operationIds,
      });
      if (!ended) input.operationIds.forget();
      await input.refresh();
      if (!ended) return { error: END_FAILED };
      step = 'read';
    }
    const read = await getTimeEntries({
      organizationId,
      userId: input.userId,
      ...replacementWindow(replacement, new Date()),
    });
    if (!read.success) return { error: READ_FAILED };
    const entry = replacedSegmentEnd(read.entries, replacement);
    return entry ? { entry } : { error: NOT_FOUND };
  } catch (failure) {
    logError('clock replacement: step failed', failure);
    return { error: step === 'end' ? END_FAILED : READ_FAILED };
  }
}

type ClockUnsentReplacementProps = {
  replacement: SessionReplacement;
  organizationId: string;
  userId: string;
  /** Another outbox action runs: the flow waits for it. */
  busy: boolean;
  /** The correction is filed: the events it covers leave the phone. */
  onFiled: (events: SessionReplacement['events']) => Promise<void>;
  /** Reports the end or the read running, so the sheet refuses its dismissal until it answers. */
  onPendingChange: ((pending: boolean) => void) | undefined;
};

export default function ClockUnsentReplacement(props: ClockUnsentReplacementProps) {
  const { replacement, organizationId, userId, busy, onFiled, onPendingChange } = props;
  const { confirmed, refresh } = useClockState();
  const { run, isPending } = usePendingTask();
  useReportPending(isPending, onPendingChange);
  const [error, setError] = useState<string | null>(null);
  // What the form edits, with the events it covers as the flow saw them when it started.
  const [target, setTarget] = useState<{ entry: TimeEntry; covers: SessionReplacement } | null>(null);
  // One id per end or recovery request: a retry after a lost answer replays it instead of a second end.
  const operations = useRef(new Map<string, string>());
  const operationIds: OperationIds = {
    id: (action, version) => {
      const key = `${action}:${String(version)}`;
      const known = operations.current.get(key);
      if (known) return known;
      const created = crypto.randomUUID();
      operations.current.set(key, created);
      return created;
    },
    forget: () => operations.current.clear(),
  };
  const closedPeriods = useClosedTimePeriods(organizationId, target !== null);
  // The clock offers an end only for a running session; only that session's end is this flow's.
  const running =
    deriveClockActions(confirmed).some((action) => action.kind === 'end') &&
    confirmed?.sessionId === replacement.sessionId;

  function start() {
    setError(null);
    const covers = replacement;
    void run(async () => {
      const prepared = await prepareReplacement({
        replacement: covers,
        organizationId,
        userId,
        runningVersion: running ? (confirmed?.sessionVersion ?? null) : undefined,
        operationIds,
        refresh,
      });
      if ('error' in prepared) setError(prepared.error);
      else setTarget({ entry: prepared.entry, covers });
    });
  }

  return (
    <div className="space-y-2">
      <ReplacementIntro running={running} capturedEnd={replacement.capturedEnd} />
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        pending={isPending}
        disabled={busy}
        onClick={start}
      >
        Korrektur beantragen
      </Button>
      <ErrorText>{error}</ErrorText>
      {target && (
        <ReplacementDialog.Dialog
          open
          onOpenChange={(open) => !open && setTarget(null)}
          organizationId={organizationId}
          entry={target.entry}
          closedPeriods={closedPeriods}
          // Only a filed edit replaces the recorded end: only then do the events it covers leave the phone.
          onSubmitted={(filed) => {
            if (filed.kind === 'edit') void onFiled(target.covers.events);
            else setError(NOT_REPLACED);
          }}
        />
      )}
    </div>
  );
}
