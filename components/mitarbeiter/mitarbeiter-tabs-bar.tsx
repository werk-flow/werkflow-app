'use client';

import { RefreshButton } from '@/components/ui/refresh-button';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';

type MitarbeiterTabsBarProps = {
  memberCount: number;
  pendingCount: number;
  onRefreshStatus: () => Promise<unknown>;
};

/** The tab triggers with their counts and the refresh button. */
export function MitarbeiterTabsBar({ memberCount, pendingCount, onRefreshStatus }: MitarbeiterTabsBarProps) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <TabsList className="min-w-0 shrink gap-1">
        <TabsTrigger value="members" className="group">
          Mitglieder
          <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/20 text-[10px] font-semibold text-muted-foreground group-data-[state=active]:text-foreground">
            {memberCount}
          </span>
        </TabsTrigger>
        <TabsTrigger value="invitations" className="group">
          Einladungen
          {pendingCount > 0 && (
            <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary-text group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
              {pendingCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="teams">Teams</TabsTrigger>
        <TabsTrigger value="qualifications">Qualifikationen</TabsTrigger>
      </TabsList>

      {/* Route refresh plus the member status refetch; rows stay on screen. */}
      <RefreshButton
        label="Tabellen aktualisieren"
        onRefresh={async () => {
          await onRefreshStatus();
        }}
        withRouteRefresh
      />
    </div>
  );
}
