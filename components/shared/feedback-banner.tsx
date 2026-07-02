'use client';

import { useCallback, useEffect } from 'react';
import { AlertCircle, CheckCircle, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export type FeedbackBannerMessage = {
  id: number;
  message: string;
  variant: 'success' | 'error';
};

type FeedbackBannerProps = {
  feedback: FeedbackBannerMessage | null;
  onDismiss: () => void;
};

export function FeedbackBanner({ feedback, onDismiss }: FeedbackBannerProps) {
  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (!feedback) return;

    const timer = setTimeout(handleDismiss, 3000);
    return () => clearTimeout(timer);
  }, [feedback, handleDismiss]);

  if (!feedback) return null;

  const Icon = feedback.variant === 'success' ? CheckCircle : AlertCircle;

  return (
    <div
      className={cn(
        'fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-lg',
        'animate-banner-in'
      )}
      role="alert"
      aria-live="assertive"
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg p-4 shadow-lg ring-1',
          feedback.variant === 'success'
            ? 'bg-green-50 text-green-800 ring-green-200/50 dark:bg-green-950 dark:text-green-200 dark:ring-green-800/50'
            : 'bg-red-50 text-red-800 ring-red-200/50 dark:bg-red-950 dark:text-red-200 dark:ring-red-800/50'
        )}
      >
        <Icon className="size-5 shrink-0" />
        <p className="flex-1 text-sm font-medium">{feedback.message}</p>
        <button
          type="button"
          onClick={handleDismiss}
          className={cn(
            'shrink-0 rounded-md p-1 transition-colors',
            feedback.variant === 'success'
              ? 'hover:bg-green-100 dark:hover:bg-green-900'
              : 'hover:bg-red-100 dark:hover:bg-red-900'
          )}
          aria-label="Banner schließen"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
