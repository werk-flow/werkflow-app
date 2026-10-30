'use client';

import { ErrorText } from '@/components/ui/error-text';

import { DetailColumns } from '@/components/shared/detail-columns';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { RegionLoadError } from '@/components/shared/region-load-error';
import type { PersonnelQualificationSummaryData } from './personnel-qualification-summary';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { RealtimeTable } from '@/lib/realtime/tables';
import type { PersonnelDetail } from '@/lib/personnel/actions';

import type { MemberDetail } from '@/lib/members/actions';
import type { OrgRole } from '@/lib/roles';
import type { OrgBreakMode } from '@/lib/time-tracking/settings';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
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
import { useMitarbeiterDetailLiveTime, type MemberInitialWeek } from './use-mitarbeiter-detail-live-time';
import { useMitarbeiterDetailMemberActions } from './use-mitarbeiter-detail-member-actions';

// The server props of the detail page that a change of these tables outdates.
const DETAIL_REFRESH_TABLES: readonly RealtimeTable[] = [
  'organization_settings',
  'employee_records',
  'employment_conditions',
  'work_schedules',
  'teams',
  'team_memberships',
  'organization_capabilities',
  'employee_capabilities',
];

/** The live status and week cards of one member. */
function MitarbeiterDetailLiveTimeCards(input: Parameters<typeof useMitarbeiterDetailLiveTime>[0]) {
  const liveTime = useMitarbeiterDetailLiveTime(input);
  return (
    <MitarbeiterDetailTimeCards
      liveTime={liveTime}
      breakMode={input.breakMode}
      autoBreakThresholdMinutes={input.autoBreakThresholdMinutes}
      autoBreakDurationMinutes={input.autoBreakDurationMinutes}
    />
  );
}

interface MitarbeiterDetailContentProps {
  member: MemberDetail;
  personnel: PersonnelDetail | null;
  personnelLoadFailed: boolean;
  /** Null when the names could not be read: the history says so with a retry. */
  actorNames: Record<string, string> | null;
  /** `null` when the jobs region failed to load. */
  jobs: Job[] | null;
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
  members: OrgMemberOption[];
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
  /** `null` when the server read of the week failed. */
  initialWeek: MemberInitialWeek | null;
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
  clientMap,
  jobAssignmentMap,
  members,
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  visibleColumns,
  documents,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
  initialWeek,
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

  useRealtimeRouterRefresh({ tables: DETAIL_REFRESH_TABLES });

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
        <DetailColumns layout="cards-and-table">
          {/* Left Column: Profile + Status */}
          <div className="grid grid-cols-1 gap-6 @[70rem]/detail:grid-cols-3 @7xl/detail:grid-cols-1">
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

            <div className="min-w-0 @[70rem]/detail:col-span-2 @7xl/detail:col-span-1">
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

            <MitarbeiterDetailLiveTimeCards
              // The week view keeps its first data after mount; new entry or exit
              // dates from the refreshed server props remount it with the new targets.
              key={`${personnel?.record.entryDate ?? ''}:${personnel?.record.exitDate ?? ''}`}
              organizationId={organizationId}
              userId={member.userId}
              breakMode={breakMode}
              autoBreakThresholdMinutes={autoBreakThresholdMinutes}
              autoBreakDurationMinutes={autoBreakDurationMinutes}
              initialWeek={initialWeek}
            />
          </div>

          {/* Right Column: Jobs Table */}
          <MitarbeiterDetailAssignedJobs
            member={member}
            jobs={jobs}
            projects={projects}
            clientMap={clientMap}
            jobAssignmentMap={jobAssignmentMap}
            members={members}
            isAdminOrManager={isAdminOrManager}
            visibleColumns={visibleColumns}
          />
        </DetailColumns>
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
