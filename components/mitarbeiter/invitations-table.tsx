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
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { PendingRow } from '@/components/ui/pending-row';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { useBusyIds } from '@/hooks/use-busy-id';
import type { OptimisticListItem } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
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

const PENDING_LABEL = 'Einladung wird gesendet';

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

// One column definition for the loaded table and its skeleton (design canon).
// Invitation rows do nothing on click, so neither rows nor skeletons hover.
export const INVITATION_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'email', header: 'E-Mail', skeleton: <Skeleton className="h-5 w-48" /> },
  {
    id: 'role',
    header: 'Rolle',
    className: 'w-[140px]',
    skeleton: <Skeleton className="h-[22px] w-20 rounded-full" />,
  },
  {
    id: 'status',
    header: 'Status',
    className: 'w-[120px]',
    skeleton: <Skeleton className="h-[22px] w-16 rounded-full" />,
  },
  {
    id: 'invitedAt',
    header: 'Eingeladen am',
    className: 'w-[150px]',
    skeleton: <Skeleton className="h-5 w-20" />,
  },
  {
    id: 'expiresAt',
    header: 'Läuft ab am',
    className: 'w-[140px]',
    skeleton: <Skeleton className="h-5 w-20" />,
  },
  {
    id: 'actions',
    header: '',
    className: 'w-[50px]',
    skeleton: <Skeleton className="size-8 rounded" />,
  },
];

function InvitationsTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        {INVITATION_COLUMNS.map((column) => (
          <TableHead key={column.id} className={column.className}>
            {column.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export function InvitationsTableSkeleton({ count }: { count: number }) {
  return (
    <>
      <SkeletonList count={count} className="md:hidden">
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
        <Skeleton className="size-8 rounded shrink-0" />
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <InvitationsTableHeader />
          <TableBody>
            <SkeletonRows columns={INVITATION_COLUMNS} rows={count} />
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function displayStatusFor(invite: Invite) {
  const statusInfo = STATUS_LABELS[invite.status] || STATUS_LABELS.pending;
  const isExpired =
    invite.status === 'pending' && new Date(invite.expires_at) < new Date();
  return { isExpired, displayStatus: isExpired ? STATUS_LABELS.expired : statusInfo };
}

function RoleBadge({ role, compact }: { role: OrgRole; compact?: boolean }) {
  return (
    <span
      className={
        compact
          ? 'inline-flex items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground'
          : 'inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground'
      }
    >
      {ROLE_LABELS[role] || role}
    </span>
  );
}

/** Mobile counterpart of `PendingRow`: the draft, dimmed, without actions. */
function PendingInviteCard({ invite }: { invite: Invite }) {
  return (
    <ListRow role="status" aria-label={PENDING_LABEL} data-pending-row="" className="opacity-70">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <InlinePending active label={PENDING_LABEL} />
          <p className="min-w-0 font-medium truncate text-sm">{invite.email}</p>
          <span
            className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_LABELS.pending.className}`}
          >
            {STATUS_LABELS.pending.label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <RoleBadge role={invite.invited_role} compact />
        </div>
      </div>
    </ListRow>
  );
}

type RowBusy = {
  isBusy: boolean;
  run: <Result>(task: () => Promise<Result>) => Promise<Result>;
};

// Mobile card component for a single invite
function InviteCard({
  invite,
  busy,
  waitForChange,
}: {
  invite: Invite;
  busy: RowBusy;
  waitForChange: () => Promise<void>;
}) {
  const { isExpired, displayStatus } = displayStatusFor(invite);

  return (
    <ListRow>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 font-medium truncate text-sm">{invite.email}</p>
          <span
            className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${displayStatus.className}`}
          >
            {displayStatus.label}
          </span>
          <InlinePending active={busy.isBusy} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <RoleBadge role={invite.invited_role} compact />
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
        busy={busy}
        waitForChange={waitForChange}
      />
    </ListRow>
  );
}

interface InvitationsTableProps {
  /** Server invites plus the optimistic rows of invites just sent. */
  rows: OptimisticListItem<Invite>[];
}

// No loading prop on purpose: the list never turns into a skeleton over data
// it already has (feedback canon); `InvitationsTableSkeleton` serves loading.tsx.
export function InvitationsTable({ rows }: InvitationsTableProps) {
  // Row actions mark only their row; after the server confirms, the row stays
  // marked until the refreshed list lands. `rows` changes identity with the
  // server list (and with the optimistic overlay, which a cancel or delete
  // never touches), so it serves as the settle key.
  const { run: runBusy, isBusy } = useBusyIds();
  const waitForChange = useSettleOnChange(rows);
  const rowBusy = (inviteId: string): RowBusy => ({
    isBusy: isBusy(inviteId),
    run: (task) => runBusy(inviteId, task),
  });

  if (rows.length === 0) {
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
        {rows.map(({ item: invite, isOptimistic }) =>
          isOptimistic ? (
            <PendingInviteCard key={invite.id} invite={invite} />
          ) : (
            <InviteCard
              key={invite.id}
              invite={invite}
              busy={rowBusy(invite.id)}
              waitForChange={waitForChange}
            />
          )
        )}
      </div>

      {/* Desktop view - Table layout */}
      <div className="hidden md:block">
        <Table>
          <InvitationsTableHeader />
          <TableBody>
            {rows.map(({ item: invite, isOptimistic }) => {
              if (isOptimistic) {
                return (
                  <PendingRow
                    key={invite.id}
                    columns={INVITATION_COLUMNS}
                    label={PENDING_LABEL}
                    cells={{
                      email: <span className="font-medium">{invite.email}</span>,
                      role: <RoleBadge role={invite.invited_role} />,
                      status: (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_LABELS.pending.className}`}
                        >
                          {STATUS_LABELS.pending.label}
                        </span>
                      ),
                      actions: <span className="block size-8" />,
                    }}
                  />
                );
              }
              const { isExpired, displayStatus } = displayStatusFor(invite);

              return (
                <TableRow key={invite.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {invite.email}
                      <InlinePending active={isBusy(invite.id)} />
                    </span>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={invite.invited_role} />
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
                      busy={rowBusy(invite.id)}
                      waitForChange={waitForChange}
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
