'use client';

import { useRouterRefresh } from '@/components/ui/refresh-button';
import { SectionError } from '@/components/ui/section-error';
import { TabsContent } from '@/components/ui/tabs';
import type { QualificationWorkspace } from '@/lib/qualifications/types';
import { TeamManagementSection } from './team-management-section';
import { QualificationManagementSection } from './qualification-management-section';

type MitarbeiterTabsQualificationPanelsProps = {
  qualificationWorkspace: QualificationWorkspace | null;
};

/** The teams and qualifications tab panels, both fed by one workspace read. */
export function MitarbeiterTabsQualificationPanels({
  qualificationWorkspace,
}: MitarbeiterTabsQualificationPanelsProps) {
  // The workspace is a server read; a retry refreshes the route.
  const { refresh, isPending } = useRouterRefresh();
  return (
    <>
      <TabsContent value="teams" className="mt-4">
        {qualificationWorkspace ? (
          <TeamManagementSection
            teams={qualificationWorkspace.teams}
            teamMemberships={qualificationWorkspace.teamMemberships}
            employees={qualificationWorkspace.employees}
          />
        ) : (
          <SectionError onRetry={refresh} retryPending={isPending}>
            Die Teams konnten nicht geladen werden.
          </SectionError>
        )}
      </TabsContent>
      <TabsContent value="qualifications" className="mt-4">
        {qualificationWorkspace ? (
          <QualificationManagementSection
            capabilities={qualificationWorkspace.capabilities}
            employeeCapabilities={qualificationWorkspace.employeeCapabilities}
            employees={qualificationWorkspace.employees}
            apprenticeWarningEnabled={qualificationWorkspace.apprenticeWarningEnabled}
            isAdmin={qualificationWorkspace.isAdmin}
          />
        ) : (
          <SectionError onRetry={refresh} retryPending={isPending}>
            Die Qualifikationen konnten nicht geladen werden.
          </SectionError>
        )}
      </TabsContent>
    </>
  );
}
