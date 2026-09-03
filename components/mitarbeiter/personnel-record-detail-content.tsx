'use client';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { PersonalienSection } from '@/components/mitarbeiter/personalien-section';
import { EmploymentConditionsSection } from '@/components/mitarbeiter/employment-conditions-section';
import { WorkScheduleSection } from '@/components/mitarbeiter/work-schedule-section';
import { SicknessReportsSection } from '@/components/mitarbeiter/sickness-reports-section';
import { PersonnelHistorySection } from '@/components/mitarbeiter/personnel-history-section';
import { PersonnelInviteDialog } from '@/components/mitarbeiter/personnel-invite-dialog';
import {
  AccessStateBadge,
  EmploymentStateBadge,
} from '@/components/mitarbeiter/personnel-state-badges';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  formatEmployeeRecordName,
  getAccessState,
  getEmploymentState,
} from '@/lib/personnel/types';
import type { PersonnelDetail } from '@/lib/personnel/actions';
import {
  PersonnelQualificationSummary,
  type PersonnelQualificationSummaryData,
} from './personnel-qualification-summary';
import { PersonnelLifecycleSection } from './personnel-lifecycle-section';
import type { PersonnelLifecycleView } from '@/lib/personnel/lifecycle-actions';

interface PersonnelRecordDetailContentProps {
  detail: PersonnelDetail;
  actorNames: Record<string, string>;
  canEdit: boolean;
  qualificationSummary: PersonnelQualificationSummaryData | null;
  lifecycle: PersonnelLifecycleView | null;
  canAdministerAccess: boolean;
}

/**
 * Detail surface for personnel records without an active membership: future
 * starters, personnel without app access, and exited people. Members with an
 * active login keep the richer Mitarbeiter detail (clock status, jobs, docs).
 */
export function PersonnelRecordDetailContent({
  detail,
  actorNames,
  canEdit,
  qualificationSummary,
  lifecycle,
  canAdministerAccess,
}: PersonnelRecordDetailContentProps) {
  const { record, conditions, schedules, events, hasPendingInvite } = detail;

  useRealtimeRouterRefresh({
    tables: [
      'employee_records',
      'employment_conditions',
      'work_schedules',
      'organization_invites',
      'teams',
      'team_memberships',
      'organization_capabilities',
      'employee_capabilities',
    ],
  });

  const name = formatEmployeeRecordName(record, detail.profileName);
  const employmentState = getEmploymentState(record);
  const accessState = getAccessState(record, hasPendingInvite);

  const breadcrumbs = [
    { label: 'Mitarbeiter', href: '/mitarbeiter' },
    { label: name },
  ];

  return (
    <PageShell>
      <DetailPageHeader
        breadcrumbs={breadcrumbs}
        title={name}
        subtitle={
          record.employeeNumber
            ? `Personalnummer ${record.employeeNumber}`
            : detail.profileEmail ?? undefined
        }
        badges={
          <span className="flex flex-wrap items-center gap-1.5">
            <EmploymentStateBadge state={employmentState} />
            <AccessStateBadge state={accessState} />
          </span>
        }
        actions={
          canEdit && accessState === 'ohne_zugang' ? (
            <PersonnelInviteDialog recordId={record.id} personName={name} />
          ) : undefined
        }
      />

      <PageBody>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          <PersonalienSection record={record} canEdit={canEdit} />
          <EmploymentConditionsSection
            recordId={record.id}
            conditions={conditions}
            canEdit={canEdit}
          />
          <WorkScheduleSection
            recordId={record.id}
            schedules={schedules}
            conditions={conditions}
            canEdit={canEdit}
          />
          <SicknessReportsSection recordId={record.id} />
          <PersonnelQualificationSummary data={qualificationSummary} />
          {lifecycle ? (
            <PersonnelLifecycleSection
              data={lifecycle}
              canManage={canEdit}
              canAdministerAccess={canAdministerAccess}
            />
          ) : null}
          <PersonnelHistorySection events={events} actorNames={actorNames} />
        </div>
      </PageBody>
    </PageShell>
  );
}
