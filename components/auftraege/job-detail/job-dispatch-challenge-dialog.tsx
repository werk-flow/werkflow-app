'use client';

import type { FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';

type JobDispatchChallengeDialogProps = {
  isOpen: boolean;
  challengeReason: string;
  setChallengeReason: (reason: string) => void;
  challengeError: string | null;
  isChallenging: boolean;
  handleChallenge: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  cancelChallenge: () => void;
};

export function JobDispatchChallengeDialog({
  isOpen,
  challengeReason,
  setChallengeReason,
  challengeError,
  isChallenging,
  handleChallenge,
  cancelChallenge,
}: JobDispatchChallengeDialogProps) {
  return (
    <Dialog
      open={isOpen}
      pending={isChallenging}
      onOpenChange={(open) => {
        if (!open) {
          cancelChallenge();
        }
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Rückfrage zum Einsatz</DialogTitle>
          <DialogDescription>
            Deine Rückfrage geht an das Büro. Der Einsatz bleibt bestehen, bis das Büro entscheidet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleChallenge} noValidate className="space-y-4">
          <Field
            label="Begründung"
            htmlFor="dispatch-challenge-reason"
            required
            description="Mindestens 8 Zeichen."
            error={challengeError}
          >
            <Textarea
              value={challengeReason}
              onChange={(event) => setChallengeReason(event.target.value)}
              placeholder="z. B. Terminüberschneidung mit anderem Einsatz"
              maxLength={500}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                cancelChallenge();
              }}
              disabled={isChallenging}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isChallenging}>
              {isChallenging && <Loader2 className="size-4 animate-spin" />}
              Rückfrage senden
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
