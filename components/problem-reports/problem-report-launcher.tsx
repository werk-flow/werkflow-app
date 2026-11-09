'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useParams, usePathname } from 'next/navigation';

import { lazyDialog } from '@/components/shared/lazy-dialog';
import { useAnyDialogOpen } from '@/components/ui/open-dialog-context';
import { usePendingTask } from '@/hooks/use-server-action';
import { logError } from '@/lib/logging';
import {
  readDeviceFacts,
  recordedActivity,
  setRecordedRoute,
  startRecording,
  type DeviceFacts,
  type RecordedActivity,
} from '@/lib/problem-reports/capture/recorder';
import { routeTemplate } from '@/lib/problem-reports/capture/route-template';
import type { ProblemReportDialogProps } from './problem-report-dialog';

// The one owner of problem reporting in the app shell: the recorder that
// remembers the last presses and errors in memory, the shortcut, and the
// report dialog. The dialog, the capture and the redraw load on the press
// (docs/features/problem-reports.md), so no page's cold start carries them.

/** What one press captured: the remembered activity and the redrawn screenshot, decoded. */
export type ProblemReportCapture = {
  id: number;
  activity: RecordedActivity;
  device: DeviceFacts;
  screenshot: Promise<ImageBitmap | null>;
};

/** The desktop shortcut that opens the report dialog. */
export const PROBLEM_REPORT_SHORTCUT = 'F2';

const reportDialog = lazyDialog<ProblemReportDialogProps>(() =>
  import('./problem-report-dialog').then((module) => module.ProblemReportDialog),
);

type Launcher = { start: () => void; preparing: boolean };

const LauncherContext = createContext<Launcher | null>(null);

/**
 * The redrawn screenshot of the page as it is now. The redraw clones the
 * page in the same task that its module arrives in, before the dialog
 * opens, so the dialog never shows in it; rasterizing and decoding go on in
 * the background. A redraw that fails gives no screenshot, never a plain one.
 */
async function startScreenshot(): Promise<{ image: Promise<ImageBitmap | null> }> {
  const failed = (error: unknown): null => {
    logError('startScreenshot: redraw failed', error);
    return null;
  };
  try {
    const { redrawScreenshot } = await import('@/lib/problem-reports/screenshot/redraw-screenshot');
    return {
      image: redrawScreenshot()
        .then((png) => createImageBitmap(png))
        .catch(failed),
    };
  } catch (error) {
    return { image: Promise.resolve(failed(error)) };
  }
}

function useRecordedRoute(): void {
  const pathname = usePathname();
  const params = useParams();
  useEffect(() => startRecording(), []);
  useEffect(() => {
    setRecordedRoute(routeTemplate(pathname, params ?? {}));
  }, [pathname, params]);
}

export function ProblemReportLauncher({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [capture, setCapture] = useState<ProblemReportCapture | null>(null);
  const { run, isPending } = usePendingTask();
  const anotherDialogOpen = useAnyDialogOpen();
  // Set in the press itself, so a second press in the same frame starts nothing.
  const starting = useRef(false);
  useRecordedRoute();

  const start = useCallback(() => {
    if (starting.current) return;
    starting.current = true;
    // Nothing is captured before the press: the activity is copied now.
    const activity = recordedActivity();
    const device = readDeviceFacts();
    reportDialog.preload();
    void run(async () => {
      try {
        const { image } = await startScreenshot();
        setCapture((previous) => ({ id: (previous?.id ?? 0) + 1, activity, device, screenshot: image }));
        setOpen(true);
      } finally {
        starting.current = false;
      }
    });
  }, [run]);
  const launcher = useMemo<Launcher>(() => ({ start, preparing: isPending }), [start, isPending]);

  // An open dialog, the report dialog included, owns the keyboard.
  useEffect(() => {
    if (anotherDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== PROBLEM_REPORT_SHORTCUT || event.defaultPrevented || event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      start();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [anotherDialogOpen, start]);

  return (
    <LauncherContext.Provider value={launcher}>
      {children}
      {capture && (
        <reportDialog.Dialog key={capture.id} open={open} onOpenChange={setOpen} capture={capture} />
      )}
    </LauncherContext.Provider>
  );
}

/** Starts a report from a button inside the app shell. */
export function useProblemReportLauncher(): Launcher {
  const launcher = useContext(LauncherContext);
  if (!launcher) throw new Error('useProblemReportLauncher must be used inside ProblemReportLauncher.');
  return launcher;
}
