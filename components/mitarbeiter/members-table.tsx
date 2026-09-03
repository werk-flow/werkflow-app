'use client';

import Link from 'next/link';
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
import { InlinePending } from '@/components/ui/inline-pending';
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

type RoleChangeHandler = (
  memberId: string,
  newRole: OrgRole,
  firstName: string,
  lastName: string
) => Promise<void>;

interface MembersTableProps {
  members: OrgMember[];
  currentUserId: string;
  currentUserRole: OrgRole;
  onRoleChange: RoleChangeHandler;
  /** Status data from polling hook */
  statusMap?: Record<string, MemberStatus>;
  /**
   * The first status read is still running. Only the two status cells of a
   * member without a status yet show a skeleton; the rows stay on screen.
   */
  isStatusLoading?: boolean;
  /** Rows with a change in flight (role change until refreshed props land). */
  busyMemberIds?: ReadonlySet<string>;
  /** Resolved daily targets per member (P1-04) */
  targetsByUserId?: Record<string, DailyTarget>;
  personnelByUserId?: Record<string, PersonnelListEntry>;
  removalBlockedByUserId?: Record<string, string>;
}

// The status cells' skeletons double as their loading state in the live table.
const STATUS_SKELETON = <Skeleton className="h-[22px] w-24 rounded-full" />;
const PROGRESS_SKELETON = (
  <div className="flex items-center gap-2 min-w-[100px]">
    <Skeleton className="h-2 flex-1" />
    <Skeleton className="h-4 w-8" />
  </div>
);

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
    skeleton: STATUS_SKELETON,
  },
  {
    id: 'progress',
    header: 'Tagesfortschritt',
    className: 'w-[150px] px-4',
    skeleton: PROGRESS_SKELETON,
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
  isStatusLoading,
  isBusy,
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
  onRoleChange: RoleChangeHandler;
  status?: MemberStatus;
  isStatusLoading: boolean;
  isBusy: boolean;
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
          <Link
            href={`/mitarbeiter/${member.user_id}`}
            className="min-w-0 truncate text-sm font-medium"
            onClick={(event) => event.stopPropagation()}
          >
            {memberName}
          </Link>
          <span className="shrink-0 inline-flex items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
            {ROLE_LABELS[member.role] || member.role}
          </span>
          <InlinePending active={isBusy} />
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
        {isStatusLoading && !status ? (
          <Skeleton className="h-[18px] w-40" />
        ) : (
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
        )}
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
            isBusy={isBusy}
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
  statusMap = {},
  isStatusLoading = false,
  busyMemberIds,
  targetsByUserId,
  personnelByUserId,
  removalBlockedByUserId = {},
}: MembersTableProps) {
  const router = useRouter();
  const canManageMembers =
    currentUserRole === 'admin' || currentUserRole === 'buero';

  // No loading prop on purpose: the list never turns into a skeleton over data
  // it already has (feedback canon); `MembersTableSkeleton` serves loading.tsx.

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
              isStatusLoading={isStatusLoading}
              isBusy={busyMemberIds?.has(member.user_id) ?? false}
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
              const showStatusSkeleton = isStatusLoading && !status;
              const isBusy = busyMemberIds?.has(member.user_id) ?? false;
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
                      <span className="flex items-center gap-2">
                        <Link
                          href={`/mitarbeiter/${member.user_id}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {memberName}
                        </Link>
                        <InlinePending active={isBusy} />
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
                    {showStatusSkeleton ? (
                      STATUS_SKELETON
                    ) : (
                      <StatusBadge
                        status={status?.status}
                        isClockedIn={status?.isClockedIn ?? false}
                        isPending={status?.isPending ?? false}
                        canViewStatus={canViewStatus}
                      />
                    )}
                  </TableCell>
                  <TableCell className="px-4">
                    {showStatusSkeleton ? (
                      PROGRESS_SKELETON
                    ) : (
                      <HoursDisplay
                        status={status?.status}
                        isClockedIn={status?.isClockedIn ?? false}
                        statusStartedAt={status?.statusStartedAt ?? null}
                        workMinutes={status?.workMinutes ?? 0}
                        canViewStatus={canViewStatus}
                        target={targetsByUserId?.[member.user_id]}
                      />
                    )}
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
                        isBusy={isBusy}
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
