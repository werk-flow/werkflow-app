'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeftRight, X, Undo2, AlertCircle } from 'lucide-react';

export type BannerVariant = 'success' | 'error';

export interface ActionBannerState {
  id: number;
  variant: BannerVariant;
  message: string;
  onUndo?: () => Promise<void>;
}

interface ActionBannerProps {
  banner: ActionBannerState | null;
  onDismiss: () => void;
}

export function ActionBanner({ banner, onDismiss }: ActionBannerProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const [displayed, setDisplayed] = useState<ActionBannerState | null>(null);
  const [phase, setPhase] = useState<'idle' | 'in' | 'out'>('idle');
  const [isUndoing, setIsUndoing] = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const displayedRef = useRef<ActionBannerState | null>(null);

  const clearTimers = useCallback(() => {
    clearTimeout(autoTimerRef.current);
    clearTimeout(exitTimerRef.current);
  }, []);

  const startAutoDismiss = useCallback((variant: BannerVariant) => {
    clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => {
      setPhase('out');
      exitTimerRef.current = setTimeout(() => {
        displayedRef.current = null;
        setDisplayed(null);
        setPhase('idle');
        onDismissRef.current();
      }, 150);
    }, variant === 'error' ? 3000 : 5000);
  }, []);

  useEffect(() => {
    if (banner === null) return;

    clearTimers();

    if (displayedRef.current) {
      setPhase('out');
      exitTimerRef.current = setTimeout(() => {
        displayedRef.current = banner;
        setDisplayed(banner);
        setIsUndoing(false);
        setPhase('in');
        startAutoDismiss(banner.variant);
      }, 150);
    } else {
      displayedRef.current = banner;
      setDisplayed(banner);
      setIsUndoing(false);
      setPhase('in');
      startAutoDismiss(banner.variant);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner]);

  useEffect(() => clearTimers, [clearTimers]);

  const handleDismissClick = useCallback(() => {
    clearTimers();
    setPhase('out');
    exitTimerRef.current = setTimeout(() => {
      displayedRef.current = null;
      setDisplayed(null);
      setPhase('idle');
      onDismissRef.current();
    }, 150);
  }, [clearTimers]);

  const handleUndo = useCallback(async () => {
    if (!displayedRef.current?.onUndo || isUndoing) return;
    setIsUndoing(true);
    try {
      await displayedRef.current.onUndo();
    } finally {
      setIsUndoing(false);
      handleDismissClick();
    }
  }, [isUndoing, handleDismissClick]);

  if (!displayed || phase === 'idle') return null;

  const isError = displayed.variant === 'error';

  return (
    <div
      className={`fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ${phase === 'out' ? 'animate-banner-out' : 'animate-banner-in'}`}
    >
      <div
        className={`flex items-center gap-3 rounded-lg p-4 shadow-lg ring-1 ${
          isError
            ? 'bg-red-50 text-red-800 ring-red-200/50 dark:bg-red-950 dark:text-red-200 dark:ring-red-800/50'
            : 'bg-blue-50 text-blue-800 ring-blue-200/50 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800/50'
        }`}
      >
        {isError ? (
          <AlertCircle className="size-5 shrink-0" />
        ) : (
          <ArrowLeftRight className="size-5 shrink-0" />
        )}
        <p className="flex-1 text-sm font-medium">{displayed.message}</p>
        {!isError && displayed.onUndo && (
          <button
            onClick={handleUndo}
            disabled={isUndoing}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 transition-colors disabled:opacity-50"
          >
            <Undo2 className="size-3.5" />
            {isUndoing ? '...' : 'Rückgängig'}
          </button>
        )}
        <button
          onClick={handleDismissClick}
          className={`shrink-0 rounded-md p-1 transition-colors ${
            isError
              ? 'hover:bg-red-100 dark:hover:bg-red-900'
              : 'hover:bg-blue-100 dark:hover:bg-blue-900'
          }`}
          aria-label="Banner schließen"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
