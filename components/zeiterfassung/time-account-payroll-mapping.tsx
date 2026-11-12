'use client';

import { useState, type FormEvent } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  focusFirstVisibleInvalid,
  PersonRow,
  PersonTable,
  type PersonLayout,
} from '@/components/zeiterfassung/time-account-person-table';
import { TimeAccountSubmitButton } from '@/components/zeiterfassung/time-account-submit-button';
import { useServerAction } from '@/hooks/use-server-action';
import { savePayrollMapping } from '@/lib/time-accounts/actions';
import { getTimeAccountFailureMessage } from '@/lib/time-accounts/messages';
import {
  invalidPayrollCodeKeys,
  PAYROLL_CODE_MAX_LENGTH,
  PAYROLL_CODE_ROWS,
  type PayrollCodeRow,
} from '@/lib/time-accounts/payroll-mapping';
import type { TimeAccountSettingsData } from '@/lib/time-accounts/queries';
import { formatBerlin } from '@/lib/utils';

const CODE_ERROR = `Gib einen Lohnart-Code mit höchstens ${PAYROLL_CODE_MAX_LENGTH} Zeichen an.`;

const codeInputId = (layout: PersonLayout, key: string): string => `payroll-code-${layout}-${key}`;

function PayrollCodeRowView({
  codeRow,
  layout,
  code,
  error,
  onChange,
}: {
  codeRow: PayrollCodeRow;
  layout: PersonLayout;
  code: string;
  error: boolean;
  onChange: (code: string) => void;
}) {
  const input = (
    <Input
      id={codeInputId(layout, codeRow.key)}
      value={code}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      aria-label={layout === 'row' ? `Lohnart-Code für ${codeRow.label}` : undefined}
      aria-invalid={error || undefined}
    />
  );
  return (
    <PersonRow
      layout={layout}
      name={codeRow.label}
      form={null}
      cells={[
        {
          key: 'code',
          content:
            layout === 'row' ? (
              input
            ) : (
              <Field label="Lohnart-Code" htmlFor={codeInputId(layout, codeRow.key)} required>
                {input}
              </Field>
            ),
        },
      ]}
      error={error ? CODE_ERROR : null}
    />
  );
}

/**
 * The payroll code mapping as a table the Admin edits before confirming:
 * one Lohnart code per classification. Saving makes a new version; earlier
 * exports keep the version they were built from.
 */
function PayrollMappingForm({ settings }: { settings: TimeAccountSettingsData }) {
  const { showBanner } = useBanner();
  const [codes, setCodes] = useState(settings.payrollCodes);
  const [invalidKeys, setInvalidKeys] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(savePayrollMapping);
  const current = settings.payrollMapping;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const invalid = invalidPayrollCodeKeys(codes);
    setInvalidKeys(invalid);
    if (invalid.length > 0) {
      focusFirstVisibleInvalid(invalid.flatMap((key) => [codeInputId('row', key), codeInputId('card', key)]));
      return;
    }
    try {
      const result = await run({ codes, basedOnVersion: current?.version ?? null });
      if (!result.success) {
        setError(getTimeAccountFailureMessage('createMapping', result.error));
        return;
      }
      showBanner({ variant: 'success', message: 'Die Lohnarten-Zuordnung ist gespeichert.' });
    } catch {
      setError(getTimeAccountFailureMessage('createMapping', 'mapping_failed'));
    }
  };

  const changeCode = (key: string, code: string) => {
    setCodes((previous) => ({ ...previous, [key]: code }));
    setInvalidKeys((previous) => previous.filter((invalidKey) => invalidKey !== key));
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3" aria-label="Lohnarten-Zuordnung">
      <PersonTable
        heads={[{ label: 'Klassifikation' }, { label: 'Lohnart-Code', className: 'w-56' }]}
        renderPeople={(layout) =>
          PAYROLL_CODE_ROWS.map((codeRow) => (
            <PayrollCodeRowView
              key={codeRow.key}
              codeRow={codeRow}
              layout={layout}
              code={codes[codeRow.key] ?? ''}
              error={invalidKeys.includes(codeRow.key)}
              onChange={(code) => changeCode(codeRow.key, code)}
            />
          ))
        }
      />
      <TimeAccountSubmitButton
        isPending={isPending}
        pendingValue={null}
        pendingLabel="Lohnarten-Zuordnung wird gespeichert"
      >
        {current ? 'Als neue Version speichern' : 'Zuordnung bestätigen'}
      </TimeAccountSubmitButton>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

export function PayrollMappingCard({ settings }: { settings: TimeAccountSettingsData }) {
  const current = settings.payrollMapping;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lohnarten-Zuordnung</CardTitle>
        <CardDescription>
          {current
            ? `Aktuell: Version ${current.version}, bestätigt am ${formatBerlin(current.confirmedAt, 'date')}. Eine Änderung speichert eine neue Version, frühere Lohnexporte behalten ihre.`
            : 'Noch nicht bestätigt. Prüfe die vorgeschlagenen Codes, passe sie an deine Lohnabrechnung an und bestätige sie. Ohne Zuordnung gibt es keinen Lohnexport.'}{' '}
          Jede Version übernimmt die Personalnummern aus den Personalien.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A new version from any session remounts the form with its codes. */}
        <PayrollMappingForm key={current?.version ?? 0} settings={settings} />
      </CardContent>
    </Card>
  );
}
