'use client';

import { Award } from 'lucide-react';
import type { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { updateEmployeeCapability } from '@/lib/qualifications/actions';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { EmployeeCapabilityRecord, QualificationWorkspace } from '@/lib/qualifications/types';

import type {
  QualificationManagementGrantFormState,
  QualificationManagementRecordListState,
} from './use-qualification-management-grant-form';
import { formatGermanDate } from '@/lib/utils';

type QualificationManagementCapability = QualificationWorkspace['capabilities'][number];
type QualificationManagementEmployee = QualificationWorkspace['employees'][number];

type QualificationManagementRecordListProps = {
  recordList: QualificationManagementRecordListState;
  definitionById: Map<string, QualificationManagementCapability>;
  employeeById: Map<string, QualificationManagementEmployee>;
  form: QualificationManagementGrantFormState;
  anyBusy: boolean;
  runAction: ReturnType<typeof useBusyIds>['run'];
  settleRecord: (recordId: string) => void;
};

export function QualificationManagementRecordList({
  recordList,
  definitionById,
  employeeById,
  form,
  anyBusy,
  runAction,
  settleRecord,
}: QualificationManagementRecordListProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Aktuelle Einträge</h2>
      <div className="divide-y rounded-lg border">
        {recordList.items.length === 0 ? (
          <EmptyState size="compact" className="p-4" title="Noch keine Einträge zugeordnet." />
        ) : (
          recordList.items.map(({ item: record, isOptimistic }) => {
            const definition = definitionById.get(record.capabilityId);
            const employee = employeeById.get(record.employeeRecordId);
            if (!definition || !employee) return null;
            return (
              <QualificationManagementRecordRow
                key={record.id}
                record={record}
                definition={definition}
                employee={employee}
                isOptimistic={isOptimistic}
                recordList={recordList}
                form={form}
                anyBusy={anyBusy}
                runAction={runAction}
                settleRecord={settleRecord}
              />
            );
          })
        )}
      </div>
    </section>
  );
}

type QualificationManagementRecordActionsProps = {
  record: EmployeeCapabilityRecord;
  definition: QualificationManagementCapability;
  isOptimistic: boolean;
  recordList: QualificationManagementRecordListState;
  form: QualificationManagementGrantFormState;
  anyBusy: boolean;
  runAction: ReturnType<typeof useBusyIds>['run'];
  settleRecord: (recordId: string) => void;
};

function QualificationManagementRecordRow({
  employee,
  ...actionsProps
}: QualificationManagementRecordActionsProps & {
  employee: QualificationManagementEmployee;
}) {
  const { record, definition, isOptimistic } = actionsProps;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      data-testid="employee-capability-row"
      data-employee-name={employee.displayName}
      data-capability-name={definition.name}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Award className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="flex items-center gap-2 font-medium">
            {definition.name} · {employee.displayName}
            <InlinePending active={isOptimistic} />
          </p>
          <p className="text-xs text-muted-foreground">
            ab {formatGermanDate(record.validFrom)}
            {record.validUntil ? ' bis ' + formatGermanDate(record.validUntil) : ''}
            {definition.kind === 'certification'
              ? ' · ' +
                (record.confirmationStatus === 'confirmed' ? 'intern bestätigt' : 'nicht bestätigt') +
                ' · Nachweis: ' +
                (record.evidenceState === 'received'
                  ? 'erhalten'
                  : record.evidenceState === 'pending'
                    ? 'ausstehend'
                    : 'nicht erforderlich')
              : ''}
          </p>
        </div>
      </div>
      <QualificationManagementRecordActions {...actionsProps} />
    </div>
  );
}

type RecordFormSetters = Pick<
  QualificationManagementGrantFormState,
  | 'setEmployeeRecordId'
  | 'setCapabilityId'
  | 'setValidFrom'
  | 'setValidUntil'
  | 'setIssuer'
  | 'setRenewalDueDate'
  | 'setOperationalNote'
  | 'setConfirmed'
  | 'setEvidenceState'
  | 'setSupersedesId'
  | 'setEditingRecordId'
  | 'setGrantError'
>;

/** Fills the grant form with an entry to edit it. */
function editRecordInForm(record: EmployeeCapabilityRecord, form: RecordFormSetters) {
  const {
    setEmployeeRecordId,
    setCapabilityId,
    setValidFrom,
    setValidUntil,
    setIssuer,
    setRenewalDueDate,
    setOperationalNote,
    setConfirmed,
    setEvidenceState,
    setSupersedesId,
    setEditingRecordId,
    setGrantError,
  } = form;
  setEmployeeRecordId(record.employeeRecordId);
  setCapabilityId(record.capabilityId);
  setValidFrom(record.validFrom);
  setValidUntil(record.validUntil ?? '');
  setIssuer(record.issuer ?? '');
  setRenewalDueDate(record.renewalDueDate ?? '');
  setConfirmed(record.confirmationStatus === 'confirmed');
  setEvidenceState(record.evidenceState);
  setOperationalNote(record.operationalNote ?? '');
  setSupersedesId(null);
  setEditingRecordId(record.id);
  setGrantError(null);
}

/** Fills the grant form with a renewal of a certification entry. */
function renewRecordInForm(record: EmployeeCapabilityRecord, form: RecordFormSetters) {
  const {
    setEmployeeRecordId,
    setCapabilityId,
    setValidFrom,
    setValidUntil,
    setIssuer,
    setRenewalDueDate,
    setOperationalNote,
    setConfirmed,
    setEvidenceState,
    setSupersedesId,
    setEditingRecordId,
    setGrantError,
  } = form;
  setEmployeeRecordId(record.employeeRecordId);
  setCapabilityId(record.capabilityId);
  setValidFrom(getBusinessTodayIso());
  setValidUntil('');
  setIssuer(record.issuer ?? '');
  setRenewalDueDate('');
  setOperationalNote(record.operationalNote ?? '');
  setConfirmed(false);
  setEvidenceState('pending');
  setSupersedesId(record.id);
  setEditingRecordId(null);
  setGrantError(null);
}

type RecordConfirmationToggle = Pick<
  QualificationManagementRecordActionsProps,
  'record' | 'recordList' | 'runAction' | 'settleRecord'
> & {
  showBanner: ReturnType<typeof useBanner>['showBanner'];
};

/** Flips the internal confirmation of an entry, echoed in the list until the server answers. */
async function toggleRecordConfirmation({
  record,
  recordList,
  runAction,
  settleRecord,
  showBanner,
}: RecordConfirmationToggle) {
  const confirmationStatus = record.confirmationStatus === 'confirmed' ? 'unconfirmed' : 'confirmed';
  recordList.update(record.id, { ...record, confirmationStatus });
  await runAction(`confirm:${record.id}`, async () => {
    try {
      const result = await updateEmployeeCapability({
        recordId: record.id,
        validFrom: record.validFrom,
        validUntil: record.validUntil,
        issuer: record.issuer,
        renewalDueDate: record.renewalDueDate,
        confirmationStatus,
        evidenceState: record.evidenceState,
        operationalNote: record.operationalNote,
      });
      if (!result.success) {
        recordList.rollback(record.id);
        showBanner({
          variant: 'error',
          message: 'Die Bestätigung konnte nicht geändert werden.',
        });
        return;
      }
      showBanner({
        variant: 'success',
        message: 'Die Bestätigung wurde geändert.',
      });
      settleRecord(record.id);
    } catch {
      recordList.rollback(record.id);
      showBanner({
        variant: 'error',
        message: 'Die Bestätigung konnte nicht geändert werden.',
      });
    }
  });
}

function QualificationManagementRecordActions({
  record,
  definition,
  isOptimistic,
  recordList,
  form,
  anyBusy,
  runAction,
  settleRecord,
}: QualificationManagementRecordActionsProps) {
  const { showBanner } = useBanner();

  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={anyBusy || isOptimistic}
        onClick={() => {
          editRecordInForm(record, form);
        }}
      >
        Bearbeiten
      </Button>
      {definition.kind === 'certification' && (
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={anyBusy || isOptimistic}
            onClick={async () => {
              await toggleRecordConfirmation({ record, recordList, runAction, settleRecord, showBanner });
            }}
          >
            {record.confirmationStatus === 'confirmed' ? 'Bestätigung aufheben' : 'Bestätigen'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={anyBusy || isOptimistic}
            onClick={() => {
              renewRecordInForm(record, form);
            }}
          >
            Erneuern
          </Button>
        </>
      )}
    </div>
  );
}
