import { useEffect, useState } from 'react';

/**
 * The busy signal of a route refresh. While a refresh is queued (a Realtime
 * event waits out the debounce) or in flight (the router transition runs),
 * `<html data-route-refresh>` is set; the browser settle step waits on it
 * (lib/testing/spec-support/busy-signals.ts), so a spec neither acts nor
 * counts renders before the refreshed route lands. The attribute is written
 * outside React, so marking costs no render.
 */
const holders = new Set<symbol>();

export const ROUTE_REFRESH_ATTRIBUTE = 'data-route-refresh';

/**
 * Counts the route refreshes a Realtime event started on `<html
 * data-realtime-refreshes>`, so the route-render count of a save can tell
 * the saving session's own renders from the echo of its own write
 * (lib/testing/route-render-count.ts).
 */
export const REALTIME_REFRESH_COUNT_ATTRIBUTE = 'data-realtime-refreshes';

export function countRealtimeRefresh(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const count = Number(root.getAttribute(REALTIME_REFRESH_COUNT_ATTRIBUTE) ?? '0');
  root.setAttribute(REALTIME_REFRESH_COUNT_ATTRIBUTE, String(count + 1));
}

/** Adds or removes one holder of an `<html>` marker; the marker stands while any holder remains. */
function markHolder(holderSet: Set<symbol>, attribute: string, holder: symbol, on: boolean): void {
  if (on) holderSet.add(holder);
  else holderSet.delete(holder);
  if (typeof document === 'undefined') return;
  if (holderSet.size > 0) document.documentElement.setAttribute(attribute, 'true');
  else document.documentElement.removeAttribute(attribute);
}

export function markRouteRefresh(holder: symbol, busy: boolean): void {
  markHolder(holders, ROUTE_REFRESH_ATTRIBUTE, holder, busy);
}

/**
 * Marks a read that a live view holds back while a dialog suspends it: `<html
 * data-live-read-held>` is set while any view holds one. The view reads once
 * the dialog closes, so a lab step that starts with a held read would count
 * that catch-up as its own work (tests/audit/support/lab-recorder.ts refuses
 * to start then). Use the flag where the hook kept `pendingWhileSuspendedRef`.
 */
export const LIVE_READ_HELD_ATTRIBUTE = 'data-live-read-held';
const heldReadHolders = new Set<symbol>();

function markHeldRead(holder: symbol, held: boolean): void {
  markHolder(heldReadHolders, LIVE_READ_HELD_ATTRIBUTE, holder, held);
}

type HeldReadFlag = { current: boolean; release: () => void };

/** A live view's "read held while suspended" flag that publishes itself on `<html>`. */
function createHeldReadFlag(): HeldReadFlag {
  const holder = Symbol('held live read');
  let held = false;
  return {
    get current() {
      return held;
    },
    set current(next: boolean) {
      held = next;
      markHeldRead(holder, next);
    },
    release: () => {
      held = false;
      markHeldRead(holder, false);
    },
  };
}

/**
 * Marks a live view's read that is queued (a Realtime event or the join
 * catch-up waits out the debounce) or in flight: `<html data-live-read-pending>`
 * stands while any view has one. The Realtime ready signal queues a catch-up
 * read in every view, so the lab settle step (`settleLiveShell` in
 * tests/audit/support/performance-steps.ts) waits until the marker clears;
 * a dialog opened before would hold that read and release it inside the
 * next measured step.
 */
export const LIVE_READ_PENDING_ATTRIBUTE = 'data-live-read-pending';
const pendingReadHolders = new Set<symbol>();

export type LiveReadMarker = {
  queued: (on: boolean) => void;
  reading: (on: boolean) => void;
  release: () => void;
};

function createLiveReadMarker(): LiveReadMarker {
  const holder = Symbol('pending live read');
  let queued = false;
  let reading = false;
  const publish = (): void =>
    markHolder(pendingReadHolders, LIVE_READ_PENDING_ATTRIBUTE, holder, queued || reading);
  return {
    queued: (on) => {
      queued = on;
      publish();
    },
    reading: (on) => {
      reading = on;
      publish();
    },
    release: () => {
      queued = false;
      reading = false;
      publish();
    },
  };
}

/** The pending-read marker of one live view, released when the view unmounts. */
export function useLiveReadMarker(): LiveReadMarker {
  const [marker] = useState(createLiveReadMarker);
  useEffect(() => marker.release, [marker]);
  return marker;
}

/** The held-read flag of one live view, released when the view unmounts. */
export function useHeldReadFlag(): HeldReadFlag {
  const [flag] = useState(createHeldReadFlag);
  useEffect(() => flag.release, [flag]);
  return flag;
}
