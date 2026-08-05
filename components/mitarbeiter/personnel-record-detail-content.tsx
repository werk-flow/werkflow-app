'use client';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PersonalienSection } from '@/components/mitarbeiter/personalien-section';
import { EmploymentConditionsSection } from '@/components/mitarbeiter/employment-conditions-section';
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

interface PersonnelRecordDetailContentProps {
  detail: PersonnelDetail;
  actorNames: Record<string, string>;
  canEdit: boolean;
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
}: PersonnelRecordDetailContentProps) {
  const { record, conditions, events, hasPendingInvite } = detail;

  useRealtimeRouterRefresh({
    tables: ['employee_records', 'employment_conditions', 'organization_invites'],
  });

  const name = formatEmployeeRecordName(record, detail.profileName);
  const employmentState = getEmploymentState(record);
  const accessState = getAccessState(record, hasPendingInvite);

  const breadcrumbs = [
    { label: 'Mitarbeiter', href: '/mitarbeiter' },
    { label: name },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
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

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          <PersonalienSection record={record} canEdit={canEdit} />
          <EmploymentConditionsSection
            recordId={record.id}
            conditions={conditions}
            canEdit={canEdit}
          />
          <PersonnelHistorySection events={events} actorNames={actorNames} />
        </div>
      </div>
    </div>
  );
}
