'use client';

import { useState } from 'react';
import { Building2, Users, Copy, Check } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/components/organization/organization-context';
import { getRoleLabel } from '@/lib/roles';

interface OrgInfoCardProps {
  initialMemberCount?: number | null;
}

export function OrgInfoCard({ initialMemberCount }: OrgInfoCardProps) {
  const { activeOrg } = useOrganization();
  const [copied, setCopied] = useState(false);

  // Use the server-provided member count
  const memberCount = initialMemberCount;
  const organizationCode = activeOrg?.uniqueCode.trim();

  const handleCopyCode = async () => {
    if (!organizationCode) return;

    try {
      await navigator.clipboard.writeText(organizationCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  if (!activeOrg) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="size-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">{activeOrg.name}</CardTitle>
            <CardDescription>
              Deine Rolle: {getRoleLabel(activeOrg.role)}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Member count */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" />
          <span>
            {memberCount !== null
              ? `${memberCount} ${
                  memberCount === 1 ? 'Mitglied' : 'Mitglieder'
                }`
              : 'Lade...'}
          </span>
        </div>

        {/* Organization code - visible to admins and managers */}
        {(activeOrg.role === 'admin' || activeOrg.role === 'buero') && (
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="mb-1 text-xs text-muted-foreground">
              Organisationscode
            </p>
            <div className="flex items-center justify-between gap-2">
              <code className="text-lg font-mono font-semibold tracking-wider">{organizationCode}</code>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={handleCopyCode}
              >
                {copied ? (
                  <Check className="size-4 text-green-600" />
                ) : (
                  <Copy className="size-4" />
                )}
                <span className="sr-only">Code kopieren</span>
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Teile diesen Code mit Mitarbeitern, damit sie deiner Organisation
              beitreten können.
            </p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
