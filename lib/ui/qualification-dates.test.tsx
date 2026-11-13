import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PersonnelQualificationSummary } from '@/components/mitarbeiter/personnel-qualification-summary';
import type { CapabilityDefinition, EmployeeCapabilityRecord } from '@/lib/qualifications/types';

// werk-flow/werkflow-planning#89: the Mitarbeiter detail wrote „16.3.2025 –
// 15.3.2030“ beside padded dates such as „01.06.2011“. Every validity now
// reads like every other date. Qualifikationen (#80) uses the same formatter;
// its page imports server-only modules, so its capture shows it instead.

const definition: CapabilityDefinition = {
  id: 'capability-1',
  organizationId: 'org-1',
  kind: 'certification',
  name: 'Kältetechnik Kategorie I',
  description: null,
  defaultExpiryWarningDays: 30,
  retiredAt: null,
};
const record: EmployeeCapabilityRecord = {
  id: 'record-1',
  employeeRecordId: 'employee-1',
  capabilityId: definition.id,
  capabilityKind: 'certification',
  validFrom: '2025-09-19',
  validUntil: '2040-09-05',
  issuer: null,
  renewalDueDate: null,
  confirmationStatus: 'confirmed',
  evidenceState: 'received',
  operationalNote: null,
  supersedesId: null,
  supersededAt: null,
};

describe('qualification validity dates', () => {
  test('the Mitarbeiter detail pads day and month', () => {
    const markup = renderToStaticMarkup(
      <PersonnelQualificationSummary data={{ teamNames: [], entries: [{ definition, record }] }} />,
    );
    expect(markup).toContain('19.09.2025');
    expect(markup).toContain('05.09.2040');
    expect(markup).not.toContain('19.9.2025');
  });
});
