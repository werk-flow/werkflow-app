'use client';

import { lazyDialog } from '@/components/shared/lazy-dialog';
import type { WorkBillingPartiesDialogProps } from './work-billing-parties-dialog';

// The choice dialog with its customer pickers downloads on the „Ändern“
// intent, so a page that only shows the parties never carries it
// (lab.office.job-open).
export const lazyWorkBillingPartiesDialog = lazyDialog<WorkBillingPartiesDialogProps>(() =>
  import('./work-billing-parties-dialog').then((mod) => mod.WorkBillingPartiesDialog),
);
