'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
// The drawer needs enter and exit animations only: `m` with the DOM animation
// features keeps the full `motion` component out of every route's bundle.
import { AnimatePresence, LazyMotion, domAnimation, m } from 'framer-motion';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useProblemReportLauncher } from '@/components/problem-reports/problem-report-launcher';

/**
 * The phone's menu drawer. `children` gets the press of the menu's
 * „Problem melden“ row: it closes the drawer, and the report starts once the
 * drawer has left the page, so the screenshot shows the page, not the menu.
 */
export function MobileDrawer({
  isOpen,
  onClose,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  children: (report: () => void) => ReactNode;
}) {
  const { start } = useProblemReportLauncher();
  const [reportOnExit, setReportOnExit] = useState(false);
  // A drawer opened again before it left cancels the report its row asked for.
  if (isOpen && reportOnExit) setReportOnExit(false);
  const report = useCallback(() => {
    setReportOnExit(true);
    onClose();
  }, [onClose]);

  // Close on escape key, unless a menu inside the drawer (the profile card's)
  // already consumed it to close itself.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence
        onExitComplete={() => {
          if (!reportOnExit) return;
          setReportOnExit(false);
          start();
        }}
      >
        {isOpen && (
          <>
            {/* Backdrop */}
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={onClose}
            />

            {/* Drawer */}
            <m.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              className="fixed left-0 top-0 z-50 h-full w-72 flex-col border-r bg-card shadow-xl md:hidden flex"
            >
              {/* Close button */}
              <div className="absolute right-2 top-2 z-10">
                <Button variant="ghost" size="icon" onClick={onClose} className="size-11">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Menü schließen</span>
                </Button>
              </div>

              {children(report)}
            </m.aside>
          </>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
