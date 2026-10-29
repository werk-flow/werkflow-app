'use client';

import { useRef } from 'react';

/**
 * Focus goes back to the control that opened a layer when the layer closes.
 * Radix returns focus only to its own `DialogTrigger`; most WerkFlow dialogs
 * open from state (a header button, a row menu item, a card, a button in a
 * picker's popup), so without this Escape left focus on the page body and a
 * keyboard user lost their place (rendered audit, every controlled dialog).
 *
 * The opener can be gone, busy or replaced when the layer closes: a menu item
 * or a popup's button unmounts with its menu before the layer opens, a submit
 * is disabled while its request runs (the browser then moves focus to the body
 * without a focusout event, and Radix's trap on to the layer container), and a calendar card renders anew after a move is
 * taken back. So every focusin records its opening chain: the focused control,
 * the controls that opened the containers around it (the button whose
 * `aria-controls` names a menu or popover, or that labels a menu) and their
 * `data-focus-key`, a stable name a component gives a control it may render
 * anew (a popover on a virtual anchor names its anchor's key in
 * `data-focus-return`). A layer that opens while focus sits on the body takes the last record;
 * on close it focuses the first control of the chain still on the page, or the
 * control that now carries a remembered key, waiting for a disabled one to be
 * enabled again and for a re-rendered one to appear.
 */

type Origin = { controls: HTMLElement[]; keys: string[] };

const EMPTY_ORIGIN: Origin = { controls: [], keys: [] };

function originOf(focused: HTMLElement): Origin {
  const controls: HTMLElement[] = [focused];
  const add = (control: HTMLElement | null): void => {
    if (control && !controls.includes(control)) controls.push(control);
  };
  for (let element: HTMLElement | null = focused.parentElement; element; element = element.parentElement) {
    if (element.id) add(document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(element.id)}"]`));
    const labelledBy =
      element.getAttribute('role') === 'menu' ? element.getAttribute('aria-labelledby') : null;
    if (labelledBy) add(document.getElementById(labelledBy));
  }
  const keys = controls.flatMap((control) => {
    const own = control.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey;
    // A popover anchored to a control without a trigger names that control's key.
    const anchor = control.closest<HTMLElement>('[data-focus-return]')?.dataset.focusReturn;
    return [own, anchor].filter((key): key is string => Boolean(key));
  });
  return { controls, keys };
}

/** A layer's own container: it takes focus when the control inside it lost focus. */
function isLayerContainer(element: Element): boolean {
  return element.matches('[role="dialog"], [role="alertdialog"]');
}

/** The opening chain of the last focused control (never a layer's own container). */
let lastFocusOrigin: Origin = EMPTY_ORIGIN;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (event) => {
      if (event.target instanceof HTMLElement && !isLayerContainer(event.target))
        lastFocusOrigin = originOf(event.target);
    },
    true,
  );
}

/**
 * The opening chain at the moment a layer opens. Focus on the body or on a
 * layer's container means the control lost focus (Radix's focus trap moves
 * focus to its container when the focused control is disabled), so the last
 * focused control is the opener.
 */
function openingControls(): Origin {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body && !isLayerContainer(active))
    return originOf(active);
  return lastFocusOrigin;
}

/** The first remembered control on the page, or the control that now carries a remembered focus key. */
function returnTarget({ controls, keys }: Origin): HTMLElement | null {
  const connected = controls.find((control) => control.isConnected);
  if (connected) return connected;
  for (const key of keys) {
    const replacement = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
    if (replacement) return replacement;
  }
  return null;
}

const RESTORE_DEADLINE_MS = 10_000;
const STABLE_FRAMES = 3;

/**
 * Focuses the return target frame by frame until it holds focus for a few
 * frames: it waits while the target is missing (a card renders anew) or
 * disabled (its request still ends), and finds the replacement by key when
 * the focused target is removed. It stops when the user moved focus to
 * another control outside the closing layer, or after ten seconds.
 */
function restoreFocus(origin: Origin, closing: Element | null, deadline: number, stableFrames = 0): void {
  if (Date.now() > deadline) return;
  const target = returnTarget(origin);
  const active = document.activeElement;
  const next = (frames: number): void => {
    requestAnimationFrame(() => restoreFocus(origin, closing, deadline, frames));
  };
  if (target && active === target) {
    if (stableFrames < STABLE_FRAMES) next(stableFrames + 1);
    return;
  }
  if (active instanceof HTMLElement && active !== document.body) {
    // Focus on a control outside the closing layer is the user's move, also in
    // the dialog that holds the target: taking it back would close a picker
    // opened there right after a quick-create. Only the closing layer, or the
    // container of a layer that holds the target, where Radix's trap parks
    // focus that lost its control, still waits for the target. A layer that
    // does not hold the target opened since (its own trap wins).
    const activeLayer = active.closest('[role="dialog"], [role="alertdialog"]');
    const inClosingLayer = activeLayer !== null && activeLayer === closing;
    const parkedInHolder = active === activeLayer && (target === null || activeLayer.contains(target));
    if (!inClosingLayer && !parkedInHolder) return;
  }
  if (target && !target.matches(':disabled')) target.focus();
  next(0);
}

type AutoFocusHandler = (event: Event) => void;

/** Wraps a layer's auto-focus handlers so that closing it focuses the control that opened it. */
export function useReturnFocus(handlers: {
  onOpenAutoFocus: AutoFocusHandler | undefined;
  onCloseAutoFocus: AutoFocusHandler | undefined;
}): { onOpenAutoFocus: AutoFocusHandler; onCloseAutoFocus: AutoFocusHandler } {
  const { onOpenAutoFocus, onCloseAutoFocus } = handlers;
  const origin = useRef<Origin>(EMPTY_ORIGIN);
  return {
    onOpenAutoFocus: (event) => {
      origin.current = openingControls();
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const remembered = origin.current;
      origin.current = EMPTY_ORIGIN;
      if (remembered.controls.length === 0 && remembered.keys.length === 0) return;
      event.preventDefault();
      const closing = event.currentTarget instanceof Element ? event.currentTarget : null;
      restoreFocus(remembered, closing, Date.now() + RESTORE_DEADLINE_MS);
    },
  };
}
