'use client';

import { MessageSquareWarning } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';
import { PROBLEM_REPORT_SHORTCUT, useProblemReportLauncher } from './problem-report-launcher';

/**
 * „Problem melden“ on every page: an icon in the phone header, a row at the
 * foot of the sidebar on the desktop and in the phone menu.
 */
export function ProblemReportButton({ placement }: { placement: 'header' | 'sidebar' }) {
  const { start, preparing } = useProblemReportLauncher();
  const hydrated = useHydrated();
  if (placement === 'header') {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label="Problem melden"
        pending={preparing}
        disabled={!hydrated}
        onClick={start}
      >
        <MessageSquareWarning className="size-5" />
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      className="w-full justify-start gap-3 px-3 font-normal text-muted-foreground"
      aria-keyshortcuts={PROBLEM_REPORT_SHORTCUT}
      pending={preparing}
      disabled={!hydrated}
      onClick={start}
    >
      <MessageSquareWarning className="size-4" />
      <span className="flex-1 text-left">Problem melden</span>
      <span aria-hidden="true" className="hidden text-xs md:inline">
        {PROBLEM_REPORT_SHORTCUT}
      </span>
    </Button>
  );
}
