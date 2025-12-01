'use client';

import { Mail } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InviteActionsMenu } from './invite-actions-menu';
import type { OrgRole } from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';

export type Invite = {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  invited_role: OrgRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: {
    label: 'Ausstehend',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  accepted: {
    label: 'Akzeptiert',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  expired: {
    label: 'Abgelaufen',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  },
  cancelled: {
    label: 'Storniert',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
};

interface InvitationsTableProps {
  invites: Invite[];
}

export function InvitationsTable({ invites }: InvitationsTableProps) {
  if (invites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Mail className="size-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Keine Einladungen</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Du hast noch keine Einladungen versendet. Klicke auf &quot;Mitarbeiter
          hinzufügen&quot; um jemanden einzuladen.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>E-Mail</TableHead>
          <TableHead>Rolle</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Eingeladen am</TableHead>
          <TableHead>Läuft ab am</TableHead>
          <TableHead className="w-[70px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invites.map((invite) => {
          const statusInfo = STATUS_LABELS[invite.status] || STATUS_LABELS.pending;
          const isExpired =
            invite.status === 'pending' && new Date(invite.expires_at) < new Date();
          const displayStatus = isExpired ? STATUS_LABELS.expired : statusInfo;

          return (
            <TableRow key={invite.id}>
              <TableCell className="font-medium">{invite.email}</TableCell>
              <TableCell>
                <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                  {ROLE_LABELS[invite.invited_role] || invite.invited_role}
                </span>
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${displayStatus.className}`}
                >
                  {displayStatus.label}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(invite.created_at).toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(invite.expires_at).toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </TableCell>
              <TableCell>
                <InviteActionsMenu
                  inviteId={invite.id}
                  inviteEmail={invite.email}
                  status={invite.status}
                  isExpired={isExpired}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
