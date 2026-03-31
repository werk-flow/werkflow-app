'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ManualEntryFormContent } from '@/components/manual-entry-form-content';
import type { TimeEntry } from '@/lib/time-tracking/types';

interface ManualEntryDialogProps {
  onSuccess?: (entries: TimeEntry[]) => void | Promise<void>;
  preselectedUserId?: string;
  preselectedDate?: Date;
  trigger?: React.ReactNode;
  preselectedClockInTime?: string;
  preselectedClockOutTime?: string;
  lockEntryMode?: boolean;
  controlledOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  onOpenChange: onOpenChangeProp
}: ManualEntryDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChangeProp?.(v);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Manuelle Eintragung
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manuelle Eintragung</DialogTitle>
          <DialogDescription>
            Füge einen manuellen Zeiteintrag hinzu. Dieser muss ggf. genehmigt
            werden.
          </DialogDescription>
        </DialogHeader>
        <ManualEntryFormContent
          preselectedUserId={preselectedUserId}
          preselectedDate={preselectedDate}
          preselectedClockInTime={preselectedClockInTime}
          preselectedClockOutTime={preselectedClockOutTime}
          lockEntryMode={lockEntryMode}
          onSuccess={async (entries) => {
            await onSuccess?.(entries);
            setTimeout(() => setOpen(false), 1500);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
