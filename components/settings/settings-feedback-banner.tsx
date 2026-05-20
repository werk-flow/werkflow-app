'use client';

import { AlertCircle, CheckCircle, X } from 'lucide-react';

import { cn } from '@/lib/utils';

type SettingsFeedbackBannerProps = {
  message: string;
  variant: 'success' | 'error';
  onDismiss?: () => void;
};

export function SettingsFeedbackBanner({
  message,
  variant,
  onDismiss,
}: SettingsFeedbackBannerProps) {
  const isSuccess = variant === 'success';
  const Icon = isSuccess ? CheckCircle : AlertCircle;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg p-4 shadow-lg ring-1',
        isSuccess
          ? 'bg-green-50 text-green-800 ring-green-200/50 dark:bg-green-950 dark:text-green-200 dark:ring-green-800/50'
          : 'bg-destructive/10 text-destructive ring-destructive/20 dark:bg-destructive/15 dark:text-destructive dark:ring-destructive/30'
      )}
    >
      <Icon className="size-5 shrink-0" />
      <p className="flex-1 text-sm font-medium">{message}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            'shrink-0 rounded-md p-1 transition-colors',
            isSuccess
              ? 'hover:bg-green-100 dark:hover:bg-green-900'
              : 'hover:bg-destructive/10 dark:hover:bg-destructive/20'
          )}
          aria-label="Hinweis schließen"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
