'use client';

import { PersonalienSection } from './personalien-section';
import { EmploymentConditionsSection } from './employment-conditions-section';
import { WorkScheduleSection } from './work-schedule-section';
import { SicknessReportsSection } from './sickness-reports-section';
import { PersonnelHistorySection } from './personnel-history-section';
import {
  PersonnelQualificationSummary,
  type PersonnelQualificationSummaryData,
} from './personnel-qualification-summary';
import { ResponsibilitySummarySection } from './responsibility-summary-section';
import { PersonnelLifecycleSection } from './personnel-lifecycle-section';
import { RegionLoadError } from '@/components/shared/region-load-error';
import type { PersonnelDetail } from '@/lib/personnel/actions';
import type { PersonnelLifecycleView } from '@/lib/personnel/lifecycle-actions';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';

type MitarbeiterDetailPersonnelSectionsProps = {
  personnel: PersonnelDetail | null;
  personnelLoadFailed: boolean;
  /** Null when the names could not be read: the history says so with a retry. */
  actorNames: Record<string, string> | null;
  isAdminOrManager: boolean;
  /** `null` when the responsibility settings failed to load. */
  responsibilitySettings: ResponsibilitySettingsData | null;
  qualificationSummary: PersonnelQualificationSummaryData | null;
  /** `null` when the lifecycle failed to load; read only with a record. */
  lifecycle: PersonnelLifecycleView | null;
  canAdministerAccess: boolean;
};

/** The personnel-record sections of the left column; empty without a record, an error when its read failed. */
export function MitarbeiterDetailPersonnelSections({
  personnel,
  personnelLoadFailed,
  actorNames,
  isAdminOrManager,
  responsibilitySettings,
  qualificationSummary,
  lifecycle,
  canAdministerAccess,
}: MitarbeiterDetailPersonnelSectionsProps) {
  if (personnelLoadFailed) {
    return <RegionLoadError>Die Personalakte konnte nicht geladen werden.</RegionLoadError>;
  }

  return (
    <>
      {personnel && <PersonalienSection record={personnel.record} canEdit={isAdminOrManager} />}

      {personnel && (
        <EmploymentConditionsSection
          recordId={personnel.record.id}
          conditions={personnel.conditions}
          canEdit={isAdminOrManager}
        />
      )}

      {personnel && (
        <WorkScheduleSection
          recordId={personnel.record.id}
          schedules={personnel.schedules}
          conditions={personnel.conditions}
          canEdit={isAdminOrManager}
        />
      )}

      {personnel && isAdminOrManager && (
        <>
          <SicknessReportsSection recordId={personnel.record.id} />
          <PersonnelQualificationSummary data={qualificationSummary} />
        </>
      )}

      {personnel &&
        (responsibilitySettings ? (
          <ResponsibilitySummarySection
            employeeRecordId={personnel.record.id}
            data={responsibilitySettings}
          />
        ) : (
          <RegionLoadError>Verantwortlichkeiten konnten nicht geladen werden.</RegionLoadError>
        ))}

      {personnel &&
        (lifecycle ? (
          <PersonnelLifecycleSection
            key={lifecycle.employeeRecordId}
            data={lifecycle}
            canManage={isAdminOrManager}
            canAdministerAccess={canAdministerAccess}
          />
        ) : (
          <RegionLoadError>Der Personalprozess konnte nicht geladen werden.</RegionLoadError>
        ))}

      {personnel && <PersonnelHistorySection events={personnel.events} actorNames={actorNames} />}
    </>
  );
}
