import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MissingTimeAccountsCard } from '@/components/zeiterfassung/time-account-opening-form';
import { PayrollMappingCard } from '@/components/zeiterfassung/time-account-payroll-mapping';
import { TimePolicyCard } from '@/components/zeiterfassung/time-account-policy-card';
import { AdjustmentRequestForms } from '@/components/zeiterfassung/time-account-settings-forms';
import {
  EmployeeTimePolicyAssignmentCard,
  PendingTimeAccountAdjustments,
} from '@/components/zeiterfassung/time-account-settings-sections';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
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
      <TimePolicyCard policies={settings.policies} suggestedStartDate={settings.suggestedStartDate} />
      <EmployeeTimePolicyAssignmentCard settings={settings} today={today} />
      <MissingTimeAccountsCard settings={settings} />
      <TimeAccountAdjustmentCard settings={settings} today={today}>
        Korrekturen, Verfall und Auszahlung werden beantragt und erst nach einer getrennten Freigabe in den
        Saldo übernommen.
      </TimeAccountAdjustmentCard>
      <PayrollMappingCard settings={settings} />
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
