'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** Escape closes the non-modal panel; focus enters it on open and returns to its toggle on close. */
export function useDispatchPanelFocus(onClose: () => void): RefObject<HTMLDivElement | null> {
  // Keyboard path for the non-modal panel: Escape closes it — unless an open
  // dialog already consumed the key (Radix prevents default when it handles
  // Escape itself).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus management for the non-modal panel: focus it on open, hand focus
  // back to the toggle on close. No focus trap — the calendar stays usable.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    panelRef.current?.focus();
    return () => {
      const toggle = document.querySelector<HTMLButtonElement>('[data-testid="dispatch-panel-toggle"]');
      toggle?.focus();
    };
  }, []);

  return panelRef;
}
