'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import {
  getCapabilityKindLabel,
  type EmployeeCapabilityRecord,
  type QualificationWorkspace,
} from '@/lib/qualifications/types';

import { QualificationManagementApprenticeWarning } from './qualification-management-apprentice-warning';
import {
  QualificationManagementDefinitionForm,
  QualificationManagementDefinitionList,
} from './qualification-management-definitions';
import { QualificationManagementGrantForm } from './qualification-management-grant-form';
import { QualificationManagementRecordList } from './qualification-management-records';
import { useQualificationManagementGrantForm } from './use-qualification-management-grant-form';

const getCapabilityRecordId = (record: EmployeeCapabilityRecord) => record.id;

export function QualificationManagementSection({
  capabilities,
  employeeCapabilities,
  employees,
  apprenticeWarningEnabled,
  isAdmin,
}: Pick<
  QualificationWorkspace,
  'capabilities' | 'employeeCapabilities' | 'employees' | 'apprenticeWarningEnabled' | 'isAdmin'
>) {
  const router = useRouter();
  const busy = useBusyIds();

  const definitionById = useMemo(
    () => new Map(capabilities.map((capability) => [capability.id, capability])),
    [capabilities],
  );
  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.employeeRecordId, employee])),
    [employees],
  );
  const activeCapabilities = capabilities.filter((capability) => !capability.retiredAt);

  const employeeOptions = useMemo(
    () =>
      employees.map((employee) => ({
        value: employee.employeeRecordId,
        label: employee.displayName,
      })),
    [employees],
  );
  const capabilityOptions = useMemo(
    () =>
      activeCapabilities.map((capability) => ({
        value: capability.id,
        label: `${capability.name} · ${getCapabilityKindLabel(capability.kind)}`,
      })),
    [activeCapabilities],
  );

  const refresh = () => router.refresh();

  // A saved or toggled entry shows in the first frame; a refusal restores the
  // confirmed list. The echo ends when the refreshed entries arrive.
  const currentRecords = useMemo(
    () => employeeCapabilities.filter((record) => !record.supersededAt),
    [employeeCapabilities],
  );
  const recordList = useOptimisticList({ items: currentRecords, getId: getCapabilityRecordId });
  const settleRecord = (recordId: string) => {
    recordList.settle(recordId);
    refresh();
  };

  const grantForm = useQualificationManagementGrantForm({
    definitionById,
    recordList,
    settleRecord,
    runAction: busy.run,
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Organisationsvokabular</h2>
          <p className="text-sm text-muted-foreground">
            Lege nur Begriffe an, die ihr in der täglichen Planung verwendet. WerkFlow liefert keine
            rechtliche Bewertung.
          </p>
        </div>
        <QualificationManagementDefinitionForm
          anyBusy={busy.anyBusy}
          runAction={busy.run}
          refresh={refresh}
        />

        <QualificationManagementDefinitionList
          activeCapabilities={activeCapabilities}
          anyBusy={busy.anyBusy}
          runAction={busy.run}
          refresh={refresh}
        />
      </section>

      <QualificationManagementGrantForm
        form={grantForm}
        employeeOptions={employeeOptions}
        capabilityOptions={capabilityOptions}
        anyBusy={busy.anyBusy}
      />

      <QualificationManagementRecordList
        recordList={recordList}
        definitionById={definitionById}
        employeeById={employeeById}
        form={grantForm}
        anyBusy={busy.anyBusy}
        runAction={busy.run}
        settleRecord={settleRecord}
      />

      <QualificationManagementApprenticeWarning
        apprenticeWarningEnabled={apprenticeWarningEnabled}
        isAdmin={isAdmin}
        anyBusy={busy.anyBusy}
        runAction={busy.run}
        refresh={refresh}
      />
    </div>
  );
}
