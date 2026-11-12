'use client';

import { useState, type ReactElement } from 'react';

import { lazyDialog } from '@/components/shared/lazy-dialog';
import { ListRow } from '@/components/ui/list-row';
import { PlainButton } from '@/components/ui/plain-button';
import type { AttentionTask } from '@/lib/attention/types';
import { formatGermanDate } from '@/lib/utils';

type SiteAccessTask = Extract<AttentionTask, { sourceType: 'site_access_proposal' }>;

const lazyReviewDialog = lazyDialog<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: SiteAccessTask;
  onDecided: () => Promise<void>;
}>(() => import('./site-access-review-dialog').then((mod) => mod.SiteAccessReviewDialog));

/** A field worker's open access proposal as a row of „Zugang prüfen“; it opens the review. */
export function SiteAccessTaskRow({
  task,
  onDecided,
}: {
  task: SiteAccessTask;
  onDecided: () => Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ListRow asChild interactive variant="plain">
        <PlainButton
          className="flex w-full items-start justify-between gap-2 text-left"
          aria-label={`Zugangshinweis von ${task.proposerName} zu ${task.siteName} prüfen`}
          data-task-source={task.sourceId}
          onPointerEnter={lazyReviewDialog.preload}
          onFocus={lazyReviewDialog.preload}
          onClick={() => setOpen(true)}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{task.siteName}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {task.proposerName} · {formatGermanDate(task.proposedAt)}
              {task.jobNumber ? ` · ${task.jobNumber}` : ''}
            </span>
          </span>
        </PlainButton>
      </ListRow>
      {open && (
        <lazyReviewDialog.Dialog open={open} onOpenChange={setOpen} task={task} onDecided={onDecided} />
      )}
    </>
  );
}
