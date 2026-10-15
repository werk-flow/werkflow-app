'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeFailure } from '@/lib/action-messages';
import type { ActionFailure } from '@/lib/action-result';

/**
 * A client read that failed, together with the retry that reads it again. The
 * two rendering homes take the whole object, never the message alone:
 * `SectionError failure` for a region and `loadFailure` on the select family.
 * A failure without its retry is therefore not writable.
 */
export type ReadFailure = {
  /** What failed, in German; the „Erneut laden“ button says what to do. */
  message: string;
  retry: () => void;
  /** The retry's read is in flight. */
  retrying: boolean;
};

/** The result shape of a Server Action reader and of `readInBackground`. */
type ReadResult = { success: true } | ActionFailure;

type Settled<Success> = {
  key: string;
  attempt: number;
  data: Success | undefined;
  failureCode: string | null;
};

type ClientReadOptions<Result extends ReadResult> = {
  /** The read; forward `signal` to `readInBackground` so a superseded read is cancelled. */
  read: (signal: AbortSignal) => Promise<Result>;
  /** The values the read depends on; a change starts a fresh read and drops the old data. */
  deps: ReadonlyArray<string | number | boolean | null | undefined>;
  /** False skips the read and forgets its result, so reopening reads fresh. Default true. */
  enabled?: boolean;
  /**
   * The sentence for a failed read, or the area's own describer of a failure
   * code. A sentence also covers `load_failed`; the session, organization and
   * role codes keep their shared sentences.
   */
  failureMessage: string | ((code: string) => string);
  /** Keep the previous deps' data while the next read runs, as a search list does. */
  keepPreviousData?: boolean;
};

type ClientRead<Success> = {
  /** The last successful result for the current deps; undefined until one arrives. */
  data: Success | undefined;
  /** A read for the current deps is in flight. */
  loading: boolean;
  failure: ReadFailure | null;
  /** Reads again with the same deps and keeps the current data meanwhile. */
  reload: () => void;
};

function readSucceeded<Result extends ReadResult>(
  result: Result,
): result is Extract<Result, { success: true }> {
  return result.success;
}

function readFailureCode(result: ReadResult): string {
  return result.success ? 'unexpected_error' : result.error;
}

/**
 * The one owner of a client read's loading, failure and retry state. Use it
 * for every read that a client component starts itself (options of a dialog,
 * a section's data); a live surface uses `useLiveView` instead. A thrown read
 * counts as a failure, an aborted or superseded read never commits, and a
 * failed reload keeps the last data.
 */
export function useClientRead<Result extends ReadResult>({
  read,
  deps,
  enabled = true,
  failureMessage,
  keepPreviousData = false,
}: ClientReadOptions<Result>): ClientRead<Extract<Result, { success: true }>> {
  type Success = Extract<Result, { success: true }>;
  const key = JSON.stringify(deps);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<Success> | null>(null);
  // A disabled read forgets its result during render, never in an effect.
  if (!enabled && settled !== null) setSettled(null);
  // The latest reader runs; callers need not memoize it.
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const settle = (data: Success | undefined, failureCode: string | null) =>
      setSettled((previous) => ({
        key,
        attempt,
        // A failed reload keeps the last data of the same deps.
        data: data ?? (previous?.key === key ? previous.data : undefined),
        failureCode,
      }));
    readRef.current(controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (readSucceeded(result)) settle(result, null);
        else settle(undefined, readFailureCode(result));
      },
      () => {
        if (!controller.signal.aborted) settle(undefined, 'unexpected_error');
      },
    );
    return () => controller.abort();
  }, [key, attempt, enabled]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);
  const current = settled?.key === key ? settled : null;
  const loading = enabled && !(current !== null && current.attempt === attempt);
  const failureCode = current?.failureCode ?? null;
  const failure = useMemo<ReadFailure | null>(() => {
    if (failureCode === null) return null;
    const message =
      typeof failureMessage === 'string'
        ? describeFailure(failureCode, { load_failed: failureMessage }, failureMessage)
        : failureMessage(failureCode);
    return { message, retry: reload, retrying: loading };
  }, [failureCode, failureMessage, reload, loading]);
  return {
    data: current ? current.data : keepPreviousData ? settled?.data : undefined,
    loading,
    failure,
    reload,
  };
}
