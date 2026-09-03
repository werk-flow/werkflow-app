'use client';

import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { MemberActionsMenu } from './member-actions-menu';
import { StatusBadge } from './status-badge';
import { HoursDisplay } from './hours-display';
import {
  AccessStateBadge,
  EmploymentStateBadge,
} from './personnel-state-badges';
import type { OrgRole } from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';
import type { MemberStatus } from '@/hooks/use-member-status';
import type { PersonnelListEntry } from '@/lib/personnel/actions';
import { getAccessState, getEmploymentState } from '@/lib/personnel/types';
import type { DailyTarget } from '@/lib/personnel/targets';

// Roles that managers can view status for (same as MANAGED_ROLES in time-tracking/types.ts)
const BUERO_VIEWABLE_ROLES: OrgRole[] = [
  'employee'
];

/**
 * Check if the current user can view a member's working status
 * - Admins can view everyone
 * - Managers can only view: themselves + managed roles (employee, accountant, secretary)
 */
function canViewMemberStatus(
  currentUserRole: OrgRole,
  currentUserId: string,
  memberId: string,
  memberRole: OrgRole
): boolean {
  // Admins can view everyone
  if (currentUserRole === 'admin') return true;

  // Users can always see their own status
  if (currentUserId === memberId) return true;

  // Managers can only view managed roles
  if (currentUserRole === 'buero') {
    return BUERO_VIEWABLE_ROLES.includes(memberRole);
  }

  // Default: can't view
  return false;
}

export type OrgMember = {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: OrgRole;
  joined_at: string;
};

interface MembersTableProps {
  members: OrgMember[];
  currentUserId: string;
  currentUserRole: OrgRole;
  onRoleChange?: (
    memberId: string,
    newRole: OrgRole,
    firstName: string,
    lastName: string
  ) => void;
  isLoading?: boolean;
  skeletonCount?: number;
  /** Status data from polling hook */
  statusMap?: Record<string, MemberStatus>;
  /** Resolved daily targets per member (P1-04) */
  targetsByUserId?: Record<string, DailyTarget>;
  personnelByUserId?: Record<string, PersonnelListEntry>;
  removalBlockedByUserId?: Record<string, string>;
}

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart. The actions column is
// appended only for managers, see `memberColumns`.
export const MEMBER_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'name',
    header: 'Name',
    className: 'w-[18%]',
    skeleton: <Skeleton className="h-5 w-28" />,
  },
  { id: 'email', header: 'E-Mail', skeleton: <Skeleton className="h-5 w-48" /> },
  {
    id: 'role',
    header: 'Rolle',
    className: 'w-[120px] px-4',
    skeleton: <Skeleton className="h-[22px] w-20 rounded-full" />,
  },
  {
    id: 'status',
    header: 'Status',
    className: 'w-[150px] px-4',
    skeleton: <Skeleton className="h-[22px] w-24 rounded-full" />,
  },
  {
    id: 'progress',
    header: 'Tagesfortschritt',
    className: 'w-[150px] px-4',
    skeleton: (
      <div className="flex items-center gap-2 min-w-[100px]">
        <Skeleton className="h-2 flex-1" />
        <Skeleton className="h-4 w-8" />
      </div>
    ),
  },
  {
    id: 'joined',
    header: 'Beigetreten',
    className: 'w-[120px]',
    skeleton: <Skeleton className="h-5 w-20" />,
  },
];

const MEMBER_ACTIONS_COLUMN: SkeletonColumn = {
  id: 'actions',
  header: '',
  className: 'w-[50px]',
  skeleton: <Skeleton className="size-8 rounded" />,
};

export function memberColumns(showActions: boolean): readonly SkeletonColumn[] {
  return showActions ? [...MEMBER_COLUMNS, MEMBER_ACTIONS_COLUMN] : MEMBER_COLUMNS;
}

function MembersTableHeader({ columns }: { columns: readonly SkeletonColumn[] }) {
  return (
    <TableHeader>
      <TableRow>
        {columns.map((column) => (
          <TableHead key={column.id} className={column.className}>
            {column.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

/** Same frame as the loaded list; rows hover because loaded rows navigate. */
export function MembersTableSkeleton({
  count,
  showActions,
}: {
  count: number;
  showActions: boolean;
}) {
  const columns = memberColumns(showActions);
  return (
    <>
      <SkeletonList count={count} interactive className="md:hidden">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-[20px] w-[120px]" />
            <Skeleton className="h-[18px] w-[70px] rounded-full" />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Skeleton className="h-[16px] w-[160px]" />
            <Skeleton className="h-[16px] w-[100px]" />
          </div>
        </div>
        {showActions && <Skeleton className="size-8 rounded shrink-0" />}
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <MembersTableHeader columns={columns} />
          <TableBody>
            <SkeletonRows columns={columns} rows={count} interactive />
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// Mobile card component for a single member
function MemberCard({
  member,
  memberName,
  canManageMembers,
  canViewStatus,
  currentUserId,
  currentUserRole,
  onRoleChange,
  status,
  target,
  personnel,
  removalBlockedMessage,
}: {
  member: OrgMember;
  memberName: string;
  canManageMembers: boolean;
  canViewStatus: boolean;
  currentUserId: string;
  currentUserRole: OrgRole;
  onRoleChange?: (
    memberId: string,
    newRole: OrgRole,
    firstName: string,
    lastName: string
  ) => void;
  status?: MemberStatus;
  target?: DailyTarget;
  personnel?: PersonnelListEntry;
  removalBlockedMessage?: string;
}) {
  const router = useRouter();

  return (
    <ListRow
      interactive
      onClick={() => router.push(`/mitarbeiter/${member.user_id}`)}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 font-medium truncate text-sm">
            {member.first_name || member.last_name
              ? `${member.first_name} ${member.last_name}`.trim()
              : '—'}
          </p>
          <span className="shrink-0 inline-flex items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
            {ROLE_LABELS[member.role] || member.role}
          </span>
        </div>
        {personnel ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <EmploymentStateBadge state={getEmploymentState(personnel.record)} />
              <AccessStateBadge
                state={getAccessState(
                  personnel.record,
                  personnel.hasPendingInvite
                )}
              />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <StatusBadge
            status={status?.status}
            isClockedIn={status?.isClockedIn ?? false}
            isPending={status?.isPending ?? false}
            canViewStatus={canViewStatus}
          />
          <span className="text-muted-foreground/60">·</span>
          <HoursDisplay
            status={status?.status}
            isClockedIn={status?.isClockedIn ?? false}
            statusStartedAt={status?.statusStartedAt ?? null}
            workMinutes={status?.workMinutes ?? 0}
            canViewStatus={canViewStatus}
            target={target}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="min-w-0 max-w-full truncate">{member.email}</span>
          <span className="text-muted-foreground/60">·</span>
          <span>
            Beigetreten:{' '}
            {new Date(member.joined_at).toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit'
            })}
          </span>
        </div>
      </div>
      {canManageMembers && (
        <div onClick={(e) => e.stopPropagation()}>
          <MemberActionsMenu
            memberId={member.user_id}
            memberName={memberName}
            memberFirstName={member.first_name}
            memberLastName={member.last_name}
            memberRole={member.role}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            removalBlockedMessage={removalBlockedMessage}
            onRoleChange={onRoleChange}
          />
        </div>
      )}
    </ListRow>
  );
}

export function MembersTable({
  members,
  currentUserId,
  currentUserRole,
  onRoleChange,
  isLoading = false,
  skeletonCount = 0,
  statusMap = {},
  targetsByUserId,
  personnelByUserId,
  removalBlockedByUserId = {},
}: MembersTableProps) {
  const router = useRouter();
  const canManageMembers =
    currentUserRole === 'admin' || currentUserRole === 'buero';

  // Show skeleton loading state
  if (isLoading && skeletonCount > 0) {
    return (
      <MembersTableSkeleton
        count={skeletonCount}
        showActions={canManageMembers}
      />
    );
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Users className="size-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Keine Mitarbeiter</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Du hast noch keine Mitarbeiter zu deiner Organisation hinzugefügt.
          Klicke auf &quot;Mitarbeiter hinzufügen&quot; um jemanden einzuladen.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile view - Card layout */}
      <div className="space-y-2 md:hidden">
        {members.map((member) => {
          const memberName =
            member.first_name || member.last_name
              ? `${member.first_name} ${member.last_name}`.trim()
              : member.email;
          const canViewStatus = canViewMemberStatus(
            currentUserRole,
            currentUserId,
            member.user_id,
            member.role
          );

          return (
            <MemberCard
              key={member.user_id}
              member={member}
              memberName={memberName}
              canManageMembers={canManageMembers}
              canViewStatus={canViewStatus}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onRoleChange={onRoleChange}
              status={statusMap[member.user_id]}
              target={targetsByUserId?.[member.user_id]}
              personnel={personnelByUserId?.[member.user_id]}
              removalBlockedMessage={removalBlockedByUserId[member.user_id]}
            />
          );
        })}
      </div>

      {/* Desktop view - Table layout */}
      <div className="hidden md:block">
        <Table>
          <MembersTableHeader columns={memberColumns(canManageMembers)} />
          <TableBody>
            {members.map((member) => {
              const memberName =
                member.first_name || member.last_name
                  ? `${member.first_name} ${member.last_name}`.trim()
                  : member.email;
              const status = statusMap[member.user_id];
              const personnel = personnelByUserId?.[member.user_id];
              const canViewStatus = canViewMemberStatus(
                currentUserRole,
                currentUserId,
                member.user_id,
                member.role
              );

              return (
                <TableRow
                  key={member.user_id}
                  interactive
                  onClick={() => router.push(`/mitarbeiter/${member.user_id}`)}
                >
                  <TableCell className="font-medium">
                    <div className="space-y-1">
                      <span className="block">
                        {member.first_name || member.last_name
                          ? `${member.first_name} ${member.last_name}`.trim()
                          : '—'}
                      </span>
                      {personnel ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <EmploymentStateBadge
                            state={getEmploymentState(personnel.record)}
                          />
                          <AccessStateBadge
                            state={getAccessState(
                              personnel.record,
                              personnel.hasPendingInvite
                            )}
                          />
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell className="px-4">
                    <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                      {ROLE_LABELS[member.role] || member.role}
                    </span>
                  </TableCell>
                  <TableCell className="px-4">
                    <StatusBadge
                      status={status?.status}
                      isClockedIn={status?.isClockedIn ?? false}
                      isPending={status?.isPending ?? false}
                      canViewStatus={canViewStatus}
                    />
                  </TableCell>
                  <TableCell className="px-4">
                    <HoursDisplay
                      status={status?.status}
                      isClockedIn={status?.isClockedIn ?? false}
                      statusStartedAt={status?.statusStartedAt ?? null}
                      workMinutes={status?.workMinutes ?? 0}
                      canViewStatus={canViewStatus}
                      target={targetsByUserId?.[member.user_id]}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(member.joined_at).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    })}
                  </TableCell>
                  {canManageMembers && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <MemberActionsMenu
                        memberId={member.user_id}
                        memberName={memberName}
                        memberFirstName={member.first_name}
                        memberLastName={member.last_name}
                        memberRole={member.role}
                        currentUserId={currentUserId}
                        currentUserRole={currentUserRole}
                        removalBlockedMessage={
                          removalBlockedByUserId[member.user_id]
                        }
                        onRoleChange={onRoleChange}
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
