'use client';

import { useRef, useState } from 'react';
import { Building2, PlusCircle, UserPlus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useOrganization } from './organization-context';
import { CreateOrgDialog } from './create-org-dialog';
import { JoinOrgDialog } from './join-org-dialog';
import { getRoleLabel } from '@/lib/roles';

export function OrganizationSwitcher() {
  const {
    memberships,
    activeOrgId,
    setActiveOrg,
    isLoading,
    isSubscribed,
    isSwitchingOrg
  } = useOrganization();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [shouldBlurOnClose, setShouldBlurOnClose] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleValueChange = async (value: string) => {
    if (value === activeOrgId) {
      triggerRef.current?.blur();
      return;
    }

    // Mark that we should blur when the dropdown closes
    setShouldBlurOnClose(true);
    await setActiveOrg(value);
  };

  const handleOpenChange = (open: boolean) => {
    // When dropdown closes and we switched orgs, blur the trigger
    if (!open && shouldBlurOnClose) {
      // Small delay to ensure Radix has finished refocusing
      setTimeout(() => {
        triggerRef.current?.blur();
        setShouldBlurOnClose(false);
      }, 0);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={activeOrgId ?? undefined}
        onValueChange={handleValueChange}
        onOpenChange={handleOpenChange}
        disabled={isLoading || isSwitchingOrg || memberships.length === 0}
      >
        <SelectTrigger ref={triggerRef} className="w-full h-12 px-4">
          <div className="flex items-center gap-3 truncate">
            <Building2 className="size-5 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Organisation wählen" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {memberships.map((org) => (
            <SelectItem key={org.orgId} value={org.orgId}>
              <div className="flex flex-col items-start">
                <span className="font-medium">{org.name}</span>
                <span className="text-xs text-muted-foreground">
                  {getRoleLabel(org.role)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Only show create org button for subscribed users (admins) */}
      {isSubscribed && (
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

      {/* Join org button only visible to non-subscribed users (employees) */}
      {/* Admins (subscribed users) create organizations, they don't join via code */}
      {!isSubscribed && (
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
