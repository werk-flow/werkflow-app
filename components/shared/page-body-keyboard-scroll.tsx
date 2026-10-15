'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** A control the keyboard can reach: rendered, visible and outside an inert subtree. */
function holdsKeyboardControl(body: HTMLElement): boolean {
  return Array.from(body.querySelectorAll<HTMLElement>(FOCUSABLE)).some(
    (control) => control.checkVisibility({ visibilityProperty: true }) && !control.closest('[inert]'),
  );
}

/**
 * A page body that scrolls but holds no focusable control (a closed period's
 * read-only results) cannot be scrolled from the keyboard in every browser
 * (WCAG 2.1.1, axe `scrollable-region-focusable`). While that is so, the body
 * becomes a named, focusable region; as soon as a control appears or the
 * content fits, it is a plain container again, so no page gains a tab stop
 * it does not need.
 */
export function PageBodyKeyboardScroll(): React.JSX.Element {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const body = marker.current?.closest<HTMLElement>('[data-page-body]');
    if (!body) return undefined;
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
  }, []);
  return <span ref={marker} hidden />;
}
