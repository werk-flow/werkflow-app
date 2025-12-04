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
import { Skeleton } from '@/components/ui/skeleton';
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

// Mobile card skeleton - matches exact card structure
function InviteCardSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-[20px] w-[180px]" />
          <Skeleton className="h-[18px] w-[75px] rounded-full" />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Skeleton className="h-[18px] w-[70px] rounded-full" />
          <Skeleton className="h-[16px] w-[110px]" />
          <Skeleton className="h-[16px] w-[95px]" />
        </div>
      </div>
      <Skeleton className="h-8 w-8 rounded shrink-0" />
    </div>
  );
}

// Desktop table row skeleton - matches exact cell structure
function InviteRowSkeleton() {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <Skeleton className="h-5 w-48" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-[22px] w-20 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-[22px] w-16 rounded-full" />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <Skeleton className="h-5 w-20" />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <Skeleton className="h-5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-8 w-8 rounded" />
      </TableCell>
    </TableRow>
  );
}

// Mobile card component for a single invite
function InviteCard({ invite }: { invite: Invite }) {
  const statusInfo = STATUS_LABELS[invite.status] || STATUS_LABELS.pending;
  const isExpired =
    invite.status === 'pending' && new Date(invite.expires_at) < new Date();
  const displayStatus = isExpired ? STATUS_LABELS.expired : statusInfo;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate text-sm">{invite.email}</p>
          <span
            className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${displayStatus.className}`}
          >
            {displayStatus.label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
            {ROLE_LABELS[invite.invited_role] || invite.invited_role}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span>
            Eingeladen: {new Date(invite.created_at).toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
            })}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span>
            Läuft ab: {new Date(invite.expires_at).toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
            })}
          </span>
        </div>
      </div>
      <InviteActionsMenu
        inviteId={invite.id}
        inviteEmail={invite.email}
        status={invite.status}
        isExpired={isExpired}
      />
    </div>
  );
}

interface InvitationsTableProps {
  invites: Invite[];
  isLoading?: boolean;
  skeletonCount?: number;
}

export function InvitationsTable({ 
  invites,
  isLoading = false,
  skeletonCount = 0,
}: InvitationsTableProps) {
  // Show skeleton loading state
  if (isLoading && skeletonCount > 0) {
    return (
      <>
        {/* Mobile view - Card skeletons */}
        <div className="space-y-2 md:hidden">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <InviteCardSkeleton key={i} />
          ))}
        </div>

        {/* Desktop view - Table skeletons */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-Mail</TableHead>
                <TableHead className="w-[140px]">Rolle</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[150px]">Eingeladen am</TableHead>
                <TableHead className="w-[140px]">Läuft ab am</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: skeletonCount }).map((_, i) => (
                <InviteRowSkeleton key={i} />
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

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
    <>
      {/* Mobile view - Card layout */}
      <div className="space-y-2 md:hidden">
        {invites.map((invite) => (
          <InviteCard key={invite.id} invite={invite} />
        ))}
      </div>

      {/* Desktop view - Table layout */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>E-Mail</TableHead>
              <TableHead className="w-[140px]">Rolle</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[150px]">Eingeladen am</TableHead>
              <TableHead className="w-[140px]">Läuft ab am</TableHead>
              <TableHead className="w-[50px]"></TableHead>
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
      </div>
    </>
  );
}
