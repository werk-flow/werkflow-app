'use client';

import { useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MembersTable, type OrgMember } from './members-table';
import { InvitationsTable, type Invite } from './invitations-table';
import { RoleChangeBanner, type RoleChangeInfo } from './role-change-banner';
import type { OrgRole } from '@/lib/members/actions';

interface MitarbeiterTabsProps {
  members: OrgMember[];
  invites: Invite[];
  currentUserId: string;
  currentUserRole: OrgRole;
}

export function MitarbeiterTabs({
  members: initialMembers,
  invites,
  currentUserId,
  currentUserRole
}: MitarbeiterTabsProps) {
  // Manage members state locally for optimistic updates
  const [members, setMembers] = useState<OrgMember[]>(initialMembers);
  
  // Track role change info for banner
  const [roleChangeInfo, setRoleChangeInfo] = useState<RoleChangeInfo | null>(null);

  // Handle role change with optimistic update
  const handleRoleChange = useCallback((
    memberId: string,
    newRole: OrgRole,
    firstName: string,
    lastName: string
  ) => {
    // Optimistically update the members list
    setMembers(prevMembers => 
      prevMembers.map(member => 
        member.user_id === memberId 
          ? { ...member, role: newRole }
          : member
      )
    );
    
    // Show the success banner
    setRoleChangeInfo({ firstName, lastName, newRole });
  }, []);

  // Dismiss banner callback
  const handleBannerDismiss = useCallback(() => {
    setRoleChangeInfo(null);
  }, []);

  // Count pending invites for the badge
  const pendingCount = invites.filter(
    (i) => i.status === 'pending' && new Date(i.expires_at) > new Date()
  ).length;

  return (
    <>
      <RoleChangeBanner 
        roleChangeInfo={roleChangeInfo} 
        onDismiss={handleBannerDismiss} 
      />
      <Tabs defaultValue="members" className="w-full">
        <TabsList className="gap-1">
          <TabsTrigger value="members" className="group">
            Mitglieder
            <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/20 text-[10px] font-semibold text-muted-foreground group-data-[state=active]:text-foreground">
              {members.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="invitations" className="group">
            Einladungen
            {pendingCount > 0 && (
              <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4">
          <MembersTable
            members={members}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            onRoleChange={handleRoleChange}
          />
        </TabsContent>
        <TabsContent value="invitations" className="mt-4">
          <InvitationsTable invites={invites} />
        </TabsContent>
      </Tabs>
    </>
  );
}
