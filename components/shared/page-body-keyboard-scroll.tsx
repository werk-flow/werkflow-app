'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** A control the keyboard can reach: rendered, visible and outside an inert subtree. */
function holdsKeyboardControl(body: HTMLElement): boolean {
  return Array.from(body.querySelectorAll<HTMLElement>(FOCUSABLE)).some(
    (control) => control.checkVisibility({ visibilityProperty: true }) && !control.closest('[inert]'),
  );
}

/** Keeps one page body a focusable region exactly while it needs to be one; returns the cleanup. */
function followPageBody(body: HTMLElement): () => void {
  let frame = 0;
  const update = (): void => {
    frame = 0;
    const needsFocus = body.scrollHeight > body.clientHeight + 1 && !holdsKeyboardControl(body);
    if (needsFocus === body.hasAttribute('tabindex')) return;
    if (needsFocus) {
      body.setAttribute('tabindex', '0');
      body.setAttribute('role', 'region');
      body.setAttribute('aria-label', 'Seiteninhalt');
    } else {
      body.removeAttribute('tabindex');
      body.removeAttribute('role');
      body.removeAttribute('aria-label');
    }
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(update);
  };
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(body);
  const mutationObserver = new MutationObserver(schedule);
  // A control that is disabled, hidden or made inert changes the answer as much as one that is removed.
  mutationObserver.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'hidden', 'inert', 'tabindex', 'href', 'class', 'style'],
  });
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
  };
}

/**
 * A page body that scrolls but holds no focusable control (a closed period's
 * read-only results) cannot be scrolled from the keyboard in every browser
 * (WCAG 2.1.1, axe `scrollable-region-focusable`). While that is so, the body
 * becomes a named, focusable region; as soon as a control appears or the
 * content fits, it is a plain container again, so no page gains a tab stop
 * it does not need.
 *
 * The app shell runs this once for every `PageBody` inside its `<main>`. A
 * client component inside the server-rendered `PageBody` put its client
 * reference, with the route's whole chunk list, into every route payload
 * (about 1.3 KB each) and pushed the job detail's segment past the prefetch
 * inlining size (docs/technical/performance.md).
 */
export function usePageBodyKeyboardScroll(main: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = main.current;
    if (!root) return undefined;
    const followed = new Map<HTMLElement, () => void>();
    let frame = 0;
    // A navigation or a resolved loading state replaces the page body element.
    const sync = (): void => {
      frame = 0;
      const bodies = new Set(root.querySelectorAll<HTMLElement>('[data-page-body]'));
      for (const [body, stop] of followed) {
        if (bodies.has(body)) continue;
        stop();
        followed.delete(body);
      }
      for (const body of bodies) if (!followed.has(body)) followed.set(body, followPageBody(body));
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(sync);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const stop of followed.values()) stop();
      followed.clear();
    };
  }, [main]);
}
