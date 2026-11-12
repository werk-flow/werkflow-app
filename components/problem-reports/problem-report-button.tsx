'use client';

import { memo } from 'react';
import { MessageSquareWarning } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';
import { PROBLEM_REPORT_SHORTCUT, useProblemReportLauncher } from './problem-report-launcher';

/**
 * „Problem melden“ on every page: an icon in the phone header, a row at the
 * foot of the sidebar on the desktop and in the phone menu. It renders once
 * React owns its events, so the server HTML of every page stays as it was
 * (lab.field.cold-start): the header keeps the box of the icon, and the row
 * appears in the free space above the profile card. A navigation re-renders
 * the sidebar, never this button. The phone menu passes `onPress`, which
 * closes the menu before the report starts.
 */
export const ProblemReportButton = memo(function ProblemReportButton({
  placement,
  onPress,
}: {
  placement: 'header' | 'sidebar';
  onPress?: (() => void) | undefined;
}) {
  const { start, preparing } = useProblemReportLauncher();
  const hydrated = useHydrated();
  if (placement === 'header') {
    if (!hydrated) return <div className="size-11" />;
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label="Problem melden"
        pending={preparing}
        onClick={start}
      >
        <MessageSquareWarning className="size-5" />
      </Button>
    );
  }
  if (!hydrated) return null;
  return (
    <div className="px-4 pb-2">
      <Button
        variant="ghost"
        className="w-full justify-start gap-3 px-3 font-normal text-muted-foreground"
        aria-keyshortcuts={PROBLEM_REPORT_SHORTCUT}
        pending={preparing}
        onClick={onPress ?? start}
      >
        <MessageSquareWarning className="size-4" />
        <span className="flex-1 text-left">Problem melden</span>
        <span aria-hidden="true" className="hidden text-xs md:inline">
          {PROBLEM_REPORT_SHORTCUT}
        </span>
      </Button>
    </div>
  );
});
