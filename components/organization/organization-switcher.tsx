'use client';

import { useState } from 'react';
import { PlusCircle, UserPlus } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import { useOrganization } from './organization-context';
import { useSidebar } from '@/components/sidebar/app-shell';
import { CreateOrgDialog } from './create-org-dialog';
import { JoinOrgDialog } from './join-org-dialog';
import { getRoleLabel } from '@/lib/roles';

export function OrganizationSwitcher() {
  const {
    memberships,
    activeOrgId,
    setActiveOrg,
    isLoading,
    isSwitchingOrg
  } = useOrganization();
  const { setIsOpen: setSidebarOpen } = useSidebar();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const hasAdminMembership = memberships.some((membership) => membership.role === 'admin');

  const handleChange = async (value: string) => {
    if (!value || value === activeOrgId) return;
    // Collapse the sidebar on mobile after switching orgs
    setSidebarOpen(false);
    await setActiveOrg(value);
  };

  return (
    <div className="flex flex-col gap-2">
      <SearchableSelect
        id="organization-switcher"
        ariaLabel="Organisation wählen"
        options={memberships.map((org) => ({
          value: org.orgId,
          label: org.name,
          description: getRoleLabel(org.role),
        }))}
        value={activeOrgId ?? ''}
        onChange={(value) => void handleChange(value)}
        placeholder="Organisation wählen"
        searchPlaceholder="Organisation suchen …"
        emptyMessage="Keine Organisation gefunden"
        disabled={isLoading || isSwitchingOrg || memberships.length === 0}
      />

      {/* Admin users create organizations; they do not join via org code */}
      {hasAdminMembership && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => setIsCreateDialogOpen(true)}
        >
          <PlusCircle className="size-4" />
          Organisation erstellen
        </Button>
      )}

      {/* Non-admin users join organizations via org code */}
      {!hasAdminMembership && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => setIsJoinDialogOpen(true)}
        >
          <UserPlus className="size-4" />
          Organisation beitreten
        </Button>
      )}

      <CreateOrgDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
      <JoinOrgDialog
        open={isJoinDialogOpen}
        onOpenChange={setIsJoinDialogOpen}
      />
    </div>
  );
}
