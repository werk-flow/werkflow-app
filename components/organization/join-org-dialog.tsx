'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { OwnJoinRequest } from '@/lib/org/types';
import { JoinOrgCodeForm } from './join-org-code-form';
import { PendingJoinRequest } from './pending-join-request';

interface JoinOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A member asks to join a further organization of the same owner. The
 * request waits for that organization's Admin or Büro; after the approval
 * the organization appears in the switcher with the next membership refresh.
 */
export function JoinOrgDialog({ open, onOpenChange }: JoinOrgDialogProps) {
  const [request, setRequest] = useState<OwnJoinRequest | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setRequest(null);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isRequesting}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Organisation beitreten</DialogTitle>
          <DialogDescription>
            Gib den Organisationscode ein, den du von deinem Admin erhalten hast. Die Organisation gibt deine
            Anfrage frei.
          </DialogDescription>
        </DialogHeader>

        {request ? (
          <>
            <PendingJoinRequest
              request={request}
              hint="Sobald ein Admin oder das Büro sie freigibt, erscheint die Organisation in deiner Auswahl."
              onWithdrawn={() => setRequest(null)}
            />
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Fertig
              </Button>
            </DialogFooter>
          </>
        ) : (
          <JoinOrgCodeForm
            inputId="dialog-org-code"
            onRequest={setRequest}
            onPendingChange={setIsRequesting}
            renderActions={(isPending) => (
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={isPending}
                >
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  Beitritt anfragen
                </Button>
              </DialogFooter>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
