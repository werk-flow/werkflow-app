import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AdjustmentRequestForms,
  DefaultPayrollMappingForm,
  StarterTimePolicyForm,
} from '@/components/zeiterfassung/time-account-settings-forms';
import {
  EmployeeTimePolicyAssignmentCard,
  MissingTimeAccountsCard,
  PendingTimeAccountAdjustments,
} from '@/components/zeiterfassung/time-account-settings-sections';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { formatGermanDate } from '@/lib/utils';
import { getTimeAccountAccess } from '@/lib/time-accounts/actions';
import { getTimeAccountSettings, type TimeAccountSettingsData } from '@/lib/time-accounts/queries';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';

/** Proposals and the open requests: the proposer withdraws, another person in scope decides. */
function TimeAccountAdjustmentCard({
  settings,
  today,
  children,
}: {
  settings: TimeAccountSettingsData;
  today: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Zeitkonto korrigieren</CardTitle>
        <CardDescription>{children}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <AdjustmentRequestForms accounts={settings.accounts} today={today} />
        <PendingTimeAccountAdjustments pendingAdjustments={settings.pendingAdjustments} />
      </CardContent>
    </Card>
  );
}

function TimeAccountSettingsContent({
  settings,
  access,
}: {
  settings: TimeAccountSettingsData;
  access: Awaited<ReturnType<typeof getTimeAccountAccess>>;
}) {
  const today = getBusinessTodayIso();
  return !access.isAdmin ? (
    access.canProposeAdjustments ? (
      <TimeAccountAdjustmentCard settings={settings} today={today}>
        Büro-Nutzer können Korrekturen, Verfall und Auszahlung beantragen. Eine getrennte Freigabe ist
        erforderlich.
      </TimeAccountAdjustmentCard>
    ) : (
      <p className="text-sm text-muted-foreground">Nur Administratoren können diese Einstellungen ändern.</p>
    )
  ) : (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arbeitszeitregel</CardTitle>
          <CardDescription>
            Der Startsatz nutzt die sechs Aktivitätsarten und 0, 50 oder 100 Prozent. Weitere Sätze und
            Prozentwerte können später ergänzt werden.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.policies.map((policy) => (
            <div key={policy.id} className="flex justify-between border-b pb-3 text-sm">
              <span>
                {policy.name}
                {policy.isDefault ? ' · Standard' : ''}
              </span>
              <span className="text-muted-foreground">
                Version {policy.version}
                {policy.effectiveFrom ? ` · ab ${formatGermanDate(policy.effectiveFrom)}` : ''}
              </span>
            </div>
          ))}
          <StarterTimePolicyForm startDate={settings.suggestedStartDate} />
        </CardContent>
      </Card>
      <EmployeeTimePolicyAssignmentCard settings={settings} today={today} />
      <MissingTimeAccountsCard settings={settings} />
      <TimeAccountAdjustmentCard settings={settings} today={today}>
        Korrekturen, Verfall und Auszahlung werden beantragt und erst nach einer getrennten Freigabe in den
        Saldo übernommen.
      </TimeAccountAdjustmentCard>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lohnarten-Zuordnung</CardTitle>
          <CardDescription>
            Versionierte Zuordnung für alle Mitarbeitenden und Klassifikationen. Aktuell:{' '}
            {settings.mappingVersion ? `Version ${settings.mappingVersion}` : 'nicht eingerichtet'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DefaultPayrollMappingForm />
        </CardContent>
      </Card>
    </>
  );
}

export default async function TimeAccountSettingsPage() {
  const [settings, access] = await Promise.all([getTimeAccountSettings(), getTimeAccountAccess()]);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageHeader
        title="Zeitregeln & Lohnexport"
        description="Jede Änderung gilt ab einem Datum. Frühere Versionen bleiben nachvollziehbar."
      />
      {settings.success ? (
        <TimeAccountSettingsContent settings={settings.data} access={access} />
      ) : (
        <RegionLoadError title="Die Zeitregeln konnten nicht geladen werden">
          Regeln, Zeitkonten und Lohnarten sind gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      )}
    </div>
  );
}
