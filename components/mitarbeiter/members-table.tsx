'use client';

import { Users } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MemberActionsMenu } from './member-actions-menu';
import type { OrgRole } from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';

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
}

export function MembersTable({
  members,
  currentUserId,
  currentUserRole,
}: MembersTableProps) {
  // Check if current user can manage members (admin or manager)
  const canManageMembers =
    currentUserRole === 'admin' || currentUserRole === 'manager';

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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>E-Mail</TableHead>
          <TableHead>Rolle</TableHead>
          <TableHead>Beigetreten</TableHead>
          {canManageMembers && <TableHead className="w-[50px]"></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const memberName = member.first_name || member.last_name
            ? `${member.first_name} ${member.last_name}`.trim()
            : member.email;

          return (
            <TableRow key={member.user_id}>
              <TableCell className="font-medium">
                {member.first_name || member.last_name
                  ? `${member.first_name} ${member.last_name}`.trim()
                  : '—'}
              </TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell>
                <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                  {ROLE_LABELS[member.role] || member.role}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(member.joined_at).toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </TableCell>
              {canManageMembers && (
                <TableCell>
                  <MemberActionsMenu
                    memberId={member.user_id}
                    memberName={memberName}
                    memberRole={member.role}
                    currentUserId={currentUserId}
                    currentUserRole={currentUserRole}
                  />
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

