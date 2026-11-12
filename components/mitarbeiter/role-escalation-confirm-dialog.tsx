'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { OrgRole } from '@/lib/roles';

/**
 * Raising a Handwerker/in to Büro opens personnel files, sickness types and
 * everyone's time, so it asks first; a downgrade applies at once. The server
 * checks every role change on its own (`updateMemberRole`).
 */
export function escalatesToBuero(currentRole: OrgRole, newRole: OrgRole): boolean {
  return currentRole === 'employee' && newRole === 'buero';
}

/** The question and the one-line effect, shared by the menus and the profile's role field. */
export function roleEscalationCopy(memberName: string) {
  return {
    title: `${memberName} zu Büro machen?`,
    description: `Als Büro sieht ${memberName} Personalakten, Krankmeldungen, die Arbeitszeiten aller Handwerker/innen und die Perioden.`,
    confirmLabel: 'Zu Büro machen',
  };
}

/** Changes a member's role and resolves with the failure sentence, or `null` once it is saved. */
export type RoleChange = (role: OrgRole) => Promise<string | null>;

/**
 * A menu's role choice: an escalation to Büro waits for the confirmation,
 * every other role goes straight to `changeRole` and reports a failure through
 * `reportFailure`. A confirmed change keeps the dialog pending until it
 * settles, and a failure stays in the open dialog.
 */
export function useConfirmedRoleChange(
  currentRole: OrgRole,
  changeRole: RoleChange,
  reportFailure: (message: string) => void,
) {
  const [confirmingRole, setConfirmingRole] = useState<OrgRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();

  const requestRoleChange = (role: OrgRole) => {
    if (escalatesToBuero(currentRole, role)) {
      setError(null);
      setConfirmingRole(role);
      return;
    }
    void changeRole(role).then((failure) => {
      if (failure) reportFailure(failure);
    });
  };

  const confirm = () => {
    if (!confirmingRole || isPending) return;
    setError(null);
    void run(async () => {
      const failure = await changeRole(confirmingRole);
      if (failure) setError(failure);
      else setConfirmingRole(null);
    });
  };

  return {
    requestRoleChange,
    confirmingRole,
    isPending,
    error,
    cancel: () => setConfirmingRole(null),
    confirm,
  };
}

type RoleEscalationConfirmDialogProps = {
  memberName: string;
  roleChange: ReturnType<typeof useConfirmedRoleChange>;
};

export function RoleEscalationConfirmDialog({ memberName, roleChange }: RoleEscalationConfirmDialogProps) {
  const { confirmingRole, isPending: pending, error, cancel, confirm } = roleChange;
  const copy = roleEscalationCopy(memberName);
  return (
    <AlertDialog
      open={confirmingRole !== null}
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
      pending={pending}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter error={error}>
          <AlertDialogCancel disabled={pending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            // Stays open until the role change is saved; a failure stays here (design skill).
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
            pending={pending}
          >
            {copy.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
