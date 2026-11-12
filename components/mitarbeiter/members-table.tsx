'use client';

import { rowIntentPrefetch } from '@/lib/ui/row-intent';
import { EmptyState } from '@/components/ui/empty-state';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';

import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow, ListRowActions } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { ColumnsTableHeader } from '@/components/ui/skeleton-table';
import { MemberActionsMenu } from './member-actions-menu';
import { STATUS_SKELETON, PROGRESS_SKELETON, memberColumns } from './members-table-columns';
import { StatusBadge } from './status-badge';
import { memberStatusVisibility, type StatusVisibility } from './member-status-visibility';
import { HoursDisplay } from './hours-display';
import { AccessStateBadge, EmploymentStateBadge } from './personnel-state-badges';
import type { OrgMemberInfo } from '@/lib/members/actions';
import type { OrgRole } from '@/lib/roles';
import { ROLE_LABELS } from '@/lib/roles';
import type { MemberStatus } from '@/hooks/use-member-status';
import type { PersonnelListEntry } from '@/lib/personnel/record-read-actions';
import { getAccessState, getEmploymentState } from '@/lib/personnel/types';
import type { DailyTarget } from '@/lib/personnel/targets';
import { formatBerlin } from '@/lib/utils';

export type OrgMember = OrgMemberInfo;

type RoleChangeHandler = (
  memberId: string,
  newRole: OrgRole,
  firstName: string,
  lastName: string,
) => Promise<string | null>;

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
  /**
   * The status read failed. A member without a last-known status shows
   * „Status nicht geladen“ instead of a status the read never delivered.
   */
  isStatusUnavailable?: boolean;
  /** Rows with a change in flight (role change until refreshed props land). */
  busyMemberIds?: ReadonlySet<string>;
  /** Resolved daily targets per member (P1-04) */
  targetsByUserId?: Record<string, DailyTarget> | undefined;
  personnelByUserId?: Record<string, PersonnelListEntry> | undefined;
  removalBlockedByUserId?: Record<string, string> | undefined;
}

type MemberRowProps = {
  member: OrgMember;
  memberName: string;
  canManageMembers: boolean;
  statusVisibility: StatusVisibility;
  currentUserId: string;
  currentUserRole: OrgRole;
  onRoleChange: RoleChangeHandler;
  status?: MemberStatus | undefined;
  isStatusLoading: boolean;
  isBusy: boolean;
  target?: DailyTarget | undefined;
  personnel?: PersonnelListEntry | undefined;
  removalBlockedMessage?: string | undefined;
};

type MemberStatusProps = Pick<MemberRowProps, 'status' | 'isStatusLoading' | 'statusVisibility' | 'target'>;

/** The mobile card's status line; a skeleton while the first status read runs. */
function MemberCardStatus({ status, isStatusLoading, statusVisibility, target }: MemberStatusProps) {
  return isStatusLoading && !status ? (
    <Skeleton className="h-[18px] w-40" />
  ) : (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <StatusBadge
        status={status?.status}
        isClockedIn={status?.isClockedIn ?? false}
        isPending={status?.isPending ?? false}
        visibility={statusVisibility}
      />
      <HoursDisplay
        status={status?.status}
        isClockedIn={status?.isClockedIn ?? false}
        statusStartedAt={status?.statusStartedAt ?? null}
        workMinutes={status?.workMinutes ?? 0}
        visibility={statusVisibility}
        target={target}
      />
    </div>
  );
}

/** The desktop row's status and hours cells; skeletons while the first status read runs. */
function MemberStatusCells({ status, isStatusLoading, statusVisibility, target }: MemberStatusProps) {
  const showStatusSkeleton = isStatusLoading && !status;

  return (
    <>
      <TableCell className="px-4">
        {showStatusSkeleton ? (
          STATUS_SKELETON
        ) : (
          <StatusBadge
            status={status?.status}
            isClockedIn={status?.isClockedIn ?? false}
            isPending={status?.isPending ?? false}
            visibility={statusVisibility}
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
            visibility={statusVisibility}
            target={target}
          />
        )}
      </TableCell>
    </>
  );
}

type MemberRowMenuProps = Pick<
  MemberRowProps,
  | 'member'
  | 'memberName'
  | 'currentUserId'
  | 'currentUserRole'
  | 'removalBlockedMessage'
  | 'isBusy'
  | 'onRoleChange'
>;

/** The row's actions menu for one member, on the card and in the table. */
function MemberRowMenu({
  member,
  memberName,
  currentUserId,
  currentUserRole,
  removalBlockedMessage,
  isBusy,
  onRoleChange,
}: MemberRowMenuProps) {
  return (
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
  );
}

// Mobile card component for a single member
function MemberCard({
  member,
  memberName,
  canManageMembers,
  statusVisibility,
  currentUserId,
  currentUserRole,
  onRoleChange,
  status,
  isStatusLoading,
  isBusy,
  target,
  personnel,
  removalBlockedMessage,
}: MemberRowProps) {
  const router = useRouter();

  return (
    <ListRow interactive onClick={() => router.push(`/mitarbeiter/${member.user_id}`)}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/mitarbeiter/${member.user_id}`}
            className="min-w-0 truncate text-sm font-medium"
            onClick={(event) => event.stopPropagation()}
          >
            {memberName}
          </Link>
          <span className="shrink-0 inline-flex items-center rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
            {ROLE_LABELS[member.role]}
          </span>
          <InlinePending active={isBusy} />
        </div>
        {personnel ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <EmploymentStateBadge state={getEmploymentState(personnel.record)} />
            <AccessStateBadge state={getAccessState(personnel.record, personnel.hasPendingInvite)} />
          </div>
        ) : null}
        <MemberCardStatus
          status={status}
          isStatusLoading={isStatusLoading}
          statusVisibility={statusVisibility}
          target={target}
        />
        <div className="text-xs text-muted-foreground">
          <span className="block truncate">{member.email}</span>
          <span>Beigetreten: {formatBerlin(member.joined_at, 'shortYearDate')}</span>
        </div>
      </div>
      {canManageMembers && (
        <ListRowActions>
          <MemberRowMenu
            member={member}
            memberName={memberName}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            removalBlockedMessage={removalBlockedMessage}
            isBusy={isBusy}
            onRoleChange={onRoleChange}
          />
        </ListRowActions>
      )}
    </ListRow>
  );
}

// Desktop table row for a single member
function MemberTableRow({
  member,
  memberName,
  canManageMembers,
  statusVisibility,
  currentUserId,
  currentUserRole,
  onRoleChange,
  status,
  isStatusLoading,
  isBusy,
  target,
  personnel,
  removalBlockedMessage,
}: MemberRowProps) {
  const router = useRouter();

  return (
    <TableRow
      interactive
      onClick={() => router.push(`/mitarbeiter/${member.user_id}`)}
      {...rowIntentPrefetch(() => router.prefetch(`/mitarbeiter/${member.user_id}`))}
    >
      <TableCell className="font-medium">
        <div className="space-y-1">
          <span className="flex items-center gap-2">
            <Link href={`/mitarbeiter/${member.user_id}`} onClick={(event) => event.stopPropagation()}>
              {memberName}
            </Link>
            <InlinePending active={isBusy} />
          </span>
          {personnel ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <EmploymentStateBadge state={getEmploymentState(personnel.record)} />
              <AccessStateBadge state={getAccessState(personnel.record, personnel.hasPendingInvite)} />
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>{member.email}</TableCell>
      <TableCell className="px-4">
        <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
          {ROLE_LABELS[member.role]}
        </span>
      </TableCell>
      <MemberStatusCells
        status={status}
        isStatusLoading={isStatusLoading}
        statusVisibility={statusVisibility}
        target={target}
      />
      <TableCell className="text-muted-foreground">{formatBerlin(member.joined_at, 'date')}</TableCell>
      {canManageMembers && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <MemberRowMenu
            member={member}
            memberName={memberName}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            removalBlockedMessage={removalBlockedMessage}
            isBusy={isBusy}
            onRoleChange={onRoleChange}
          />
        </TableCell>
      )}
    </TableRow>
  );
}

type MemberRowContext = {
  canManageMembers: boolean;
  currentUserId: string;
  currentUserRole: OrgRole;
  onRoleChange: RoleChangeHandler;
  statusMap: Record<string, MemberStatus>;
  isStatusLoading: boolean;
  isStatusUnavailable: boolean;
  busyMemberIds: ReadonlySet<string> | undefined;
  targetsByUserId: Record<string, DailyTarget> | undefined;
  personnelByUserId: Record<string, PersonnelListEntry> | undefined;
  removalBlockedByUserId: Record<string, string>;
};

/** The props of one member's card or table row: its name, status visibility and row data. */
function memberRowPropsFor(
  member: OrgMember,
  {
    canManageMembers,
    currentUserId,
    currentUserRole,
    onRoleChange,
    statusMap,
    isStatusLoading,
    isStatusUnavailable,
    busyMemberIds,
    targetsByUserId,
    personnelByUserId,
    removalBlockedByUserId,
  }: MemberRowContext,
): MemberRowProps {
  const memberName =
    member.first_name || member.last_name ? `${member.first_name} ${member.last_name}`.trim() : member.email;
  const statusVisibility = memberStatusVisibility(
    { userId: currentUserId, role: currentUserRole },
    { userId: member.user_id, role: member.role, hasStatus: Boolean(statusMap[member.user_id]) },
    isStatusUnavailable,
  );

  return {
    member,
    memberName,
    canManageMembers,
    statusVisibility,
    currentUserId,
    currentUserRole,
    onRoleChange,
    status: statusMap[member.user_id],
    isStatusLoading,
    isBusy: busyMemberIds?.has(member.user_id) ?? false,
    target: targetsByUserId?.[member.user_id],
    personnel: personnelByUserId?.[member.user_id],
    removalBlockedMessage: removalBlockedByUserId[member.user_id],
  };
}

export function MembersTable({
  members,
  currentUserId,
  currentUserRole,
  onRoleChange,
  statusMap = {},
  isStatusLoading = false,
  isStatusUnavailable = false,
  busyMemberIds,
  targetsByUserId,
  personnelByUserId,
  removalBlockedByUserId = {},
}: MembersTableProps) {
  const canManageMembers = currentUserRole === 'admin' || currentUserRole === 'buero';
  const rowContext: MemberRowContext = {
    canManageMembers,
    currentUserId,
    currentUserRole,
    onRoleChange,
    statusMap,
    isStatusLoading,
    isStatusUnavailable,
    busyMemberIds,
    targetsByUserId,
    personnelByUserId,
    removalBlockedByUserId,
  };

  // No loading prop on purpose: the list never turns into a skeleton over data
  // it already has (feedback canon); `MembersTableSkeleton` serves loading.tsx.

  if (members.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Noch keine Mitarbeiter"
        description="Lade dein Team über „Mitarbeiter einladen“ in die Organisation ein."
      />
    );
  }

  return (
    <>
      {/* Mobile view - Card layout */}
      <div className="space-y-2 md:hidden">
        {members.map((member) => (
          <MemberCard key={member.user_id} {...memberRowPropsFor(member, rowContext)} />
        ))}
      </div>

      {/* Desktop view - Table layout */}
      <div className="hidden md:block">
        <Table>
          <ColumnsTableHeader columns={memberColumns(canManageMembers)} />
          <TableBody>
            {members.map((member) => (
              <MemberTableRow key={member.user_id} {...memberRowPropsFor(member, rowContext)} />
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
