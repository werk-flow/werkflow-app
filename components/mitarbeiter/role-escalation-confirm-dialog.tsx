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

/**
 * A menu's role choice: an escalation to Büro waits for the confirmation,
 * every other role goes straight to `onRoleChange`. A confirmed change keeps
 * the dialog pending until it settles; its failure shows where the caller
 * reports every role change (the list's banner, the detail header's error).
 */
export function useConfirmedRoleChange(currentRole: OrgRole, onRoleChange: (role: OrgRole) => Promise<void>) {
  const [confirmingRole, setConfirmingRole] = useState<OrgRole | null>(null);
  const { run, isPending } = usePendingTask();

  const requestRoleChange = (role: OrgRole) => {
    if (escalatesToBuero(currentRole, role)) setConfirmingRole(role);
    else void onRoleChange(role);
  };

  const confirm = () => {
    if (!confirmingRole || isPending) return;
    void run(async () => {
      try {
        await onRoleChange(confirmingRole);
      } finally {
        setConfirmingRole(null);
      }
    });
  };

  return {
    requestRoleChange,
    confirmingRole,
    isPending,
    cancel: () => setConfirmingRole(null),
    confirm,
  };
}

type RoleEscalationConfirmDialogProps = {
  memberName: string;
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RoleEscalationConfirmDialog({
  memberName,
  open,
  pending,
  onCancel,
  onConfirm,
}: RoleEscalationConfirmDialogProps) {
  const copy = roleEscalationCopy(memberName);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      pending={pending}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            // Stays open until the role change settles (design skill, dialog close).
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
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
