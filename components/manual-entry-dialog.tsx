'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ManualEntryFormContent } from '@/components/manual-entry-form-content';
import { useOrganization } from '@/components/organization/organization-context';
import type { TimeEntry } from '@/lib/time-tracking/types';

interface ManualEntryDialogProps {
  onSuccess?: ((entries: TimeEntry[]) => void | Promise<void>) | undefined;
  preselectedUserId?: string | undefined;
  preselectedDate?: Date | undefined;
  trigger?: React.ReactNode | undefined;
  preselectedClockInTime?: string | undefined;
  preselectedClockOutTime?: string | undefined;
  lockEntryMode?: boolean | undefined;
  controlledOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

/**
 * An employee has one way to add forgotten time, „Zeit nachtragen“; the form
 * routes it by day. Admin and Büro keep the office's „Manuelle Eintragung“,
 * which also enters time for others.
 */
export function useManualEntryCopy(): { title: string; description: string } {
  const { activeOrg } = useOrganization();
  return activeOrg?.role === 'employee'
    ? {
        title: 'Zeit nachtragen',
        description: 'Trag Zeit ein, die du nicht gestempelt hast. Sie geht zur Freigabe.',
      }
    : {
        title: 'Manuelle Eintragung',
        description: 'Füge einen manuellen Zeiteintrag hinzu. Dieser muss ggf. genehmigt werden.',
      };
}

export function ManualEntryDialog({
  onSuccess,
  preselectedUserId,
  preselectedDate,
  trigger,
  preselectedClockInTime,
  preselectedClockOutTime,
  lockEntryMode,
  controlledOpen,
  onOpenChange: onOpenChangeProp,
}: ManualEntryDialogProps) {
  const { title, description } = useManualEntryCopy();
  const [internalOpen, setInternalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChangeProp?.(v);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} pending={isSaving}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {title}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ManualEntryFormContent
          preselectedUserId={preselectedUserId}
          preselectedDate={preselectedDate}
          preselectedClockInTime={preselectedClockInTime}
          preselectedClockOutTime={preselectedClockOutTime}
          lockEntryMode={lockEntryMode}
          onPendingChange={setIsSaving}
          onSuccess={async (entries) => {
            await onSuccess?.(entries);
            // Close-then-banner: the form shows the success banner.
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
