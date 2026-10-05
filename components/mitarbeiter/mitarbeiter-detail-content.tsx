'use client';

import { ErrorText } from '@/components/ui/error-text';

import { PageBody, PageShell } from '@/components/shared/page-shell';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { RegionLoadError } from '@/components/shared/region-load-error';
import type { PersonnelQualificationSummaryData } from './personnel-qualification-summary';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { PersonnelDetail } from '@/lib/personnel/actions';

import type { OrgRole, MemberDetail } from '@/lib/members/actions';
import type { OrgBreakMode } from '@/lib/time-tracking/settings';
import type { Job, ProjectWithDetails, Client } from '@/lib/jobs/types';
import type { OrganizationDocument } from '@/lib/documents/types';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import type { PersonnelLifecycleView } from '@/lib/personnel/lifecycle-actions';
import { MitarbeiterDetailAssignedJobs } from './mitarbeiter-detail-assigned-jobs';
import { MitarbeiterDetailHeader } from './mitarbeiter-detail-header';
import { MemberRemoveConfirmDialog } from './member-actions-menu-remove-dialog';
import { MitarbeiterDetailPersonnelSections } from './mitarbeiter-detail-personnel-sections';
import { MitarbeiterDetailProfileSection } from './mitarbeiter-detail-profile-section';
import { MitarbeiterDetailTimeCards } from './mitarbeiter-detail-time-cards';
import { useMitarbeiterDetailLiveTime } from './use-mitarbeiter-detail-live-time';
import { useMitarbeiterDetailMemberActions } from './use-mitarbeiter-detail-member-actions';

interface MitarbeiterDetailContentProps {
  member: MemberDetail;
  personnel: PersonnelDetail | null;
  personnelLoadFailed: boolean;
  /** Null when the names could not be read: the history says so with a retry. */
  actorNames: Record<string, string> | null;
  /** `null` when the jobs region failed to load. */
  jobs: Job[] | null;
  projects: ProjectWithDetails[];
  projectGraphProjects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
  clients: Client[];
  members: OrgMemberOption[];
  allProjects: ProjectWithDetails[];
  organizationId: string;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  visibleColumns: AuftraegeColumnId[];
  /** `null` when the documents failed to load. */
  documents: OrganizationDocument[] | null;
  breakMode: OrgBreakMode;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
  /** `null` when the responsibility settings failed to load. */
  responsibilitySettings: ResponsibilitySettingsData | null;
  qualificationSummary: PersonnelQualificationSummaryData | null;
  lifecycle: PersonnelLifecycleView | null;
  canAdministerAccess: boolean;
}

export function MitarbeiterDetailContent({
  member,
  personnel,
  personnelLoadFailed,
  actorNames,
  jobs,
  projects,
  projectGraphProjects,
  clientMap,
  jobAssignmentMap,
  clients,
  members,
  allProjects,
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  visibleColumns,
  documents,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
  responsibilitySettings,
  qualificationSummary,
  lifecycle,
  canAdministerAccess,
}: MitarbeiterDetailContentProps) {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Unbekannt';

  const memberActions = useMitarbeiterDetailMemberActions({
    member,
    fullName,
    personnel,
    personnelLoadFailed,
    currentUserId,
    currentUserRole,
    responsibilitySettings,
  });

  useRealtimeRouterRefresh({
    tables: [
      'organization_settings',
      'employee_records',
      'employment_conditions',
      'work_schedules',
      'teams',
      'team_memberships',
      'organization_capabilities',
      'employee_capabilities',
    ],
  });

  const liveTime = useMitarbeiterDetailLiveTime({
    organizationId,
    userId: member.userId,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
  });

  const {
    canManage,
    roleOptions,
    removalBlockedMessage,
    showRemoveDialog,
    setShowRemoveDialog,
    isRemoving,
    actionError,
    handleRoleChange,
    handleRemove,
  } = memberActions;

  return (
    <PageShell>
      <MitarbeiterDetailHeader
        member={member}
        personnel={personnel}
        fullName={fullName}
        memberActions={memberActions}
      />
      {actionError && !showRemoveDialog ? (
        <ErrorText className="mx-4 mt-4 sm:mx-6">{actionError}</ErrorText>
      ) : null}

      <PageBody>
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_1.5fr]">
          {/* Left Column: Profile + Status */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 2xl:grid-cols-1">
            <MitarbeiterDetailProfileSection
              member={member}
              canManage={canManage}
              roleOptions={roleOptions}
              onRoleChange={handleRoleChange}
            />

            <MitarbeiterDetailPersonnelSections
              personnel={personnel}
              personnelLoadFailed={personnelLoadFailed}
              actorNames={actorNames}
              isAdminOrManager={isAdminOrManager}
              responsibilitySettings={responsibilitySettings}
              qualificationSummary={qualificationSummary}
              lifecycle={lifecycle}
              canAdministerAccess={canAdministerAccess}
            />

            <div className="min-w-0 md:col-span-2 2xl:col-span-1">
              {documents ? (
                <ContextualDocumentsSection
                  title="Dokumente & Bilder"
                  description="Dokumente, Nachweise und Dateien zu diesem Mitarbeiter."
                  documents={documents}
                  documentTarget={{ kind: 'employee', employeeId: member.userId }}
                  contextLabel={fullName}
                  canUpload={isAdminOrManager}
                  canManage={isAdminOrManager}
                />
              ) : (
                <RegionLoadError>Dokumente und Bilder konnten nicht geladen werden.</RegionLoadError>
              )}
            </div>

            <MitarbeiterDetailTimeCards
              liveTime={liveTime}
              breakMode={breakMode}
              autoBreakThresholdMinutes={autoBreakThresholdMinutes}
              autoBreakDurationMinutes={autoBreakDurationMinutes}
            />
          </div>

          {/* Right Column: Jobs Table */}
          <MitarbeiterDetailAssignedJobs
            member={member}
            jobs={jobs}
            projects={projects}
            projectGraphProjects={projectGraphProjects}
            clientMap={clientMap}
            jobAssignmentMap={jobAssignmentMap}
            clients={clients}
            members={members}
            allProjects={allProjects}
            isAdminOrManager={isAdminOrManager}
            visibleColumns={visibleColumns}
          />
        </div>
      </PageBody>

      {/* Remove Dialog */}
      <MemberRemoveConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        memberName={fullName}
        removalBlockedMessage={removalBlockedMessage ?? undefined}
        error={actionError}
        isRemoving={isRemoving}
        onRemove={handleRemove}
      />
    </PageShell>
  );
}
