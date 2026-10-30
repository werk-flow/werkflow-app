import { Clock3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import {
  TimeAccountEventList,
  TimeAccountPeriodList,
} from '@/components/zeiterfassung/time-account-overview-lists';
import { formatMinutes } from '@/lib/time-accounts/presentation';
import { formatBerlin } from '@/lib/utils';
import {
  getTimeAccountOverview,
  OVERVIEW_EVENT_LIMIT,
  OVERVIEW_PERIOD_LIMIT,
  type TimeAccountOverview,
} from '@/lib/time-accounts/overview-queries';

export default async function TimeAccountPage() {
  const overview = await getTimeAccountOverview();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <LiveRouteRefresh
        tables={[
          'time_accounts',
          'time_account_adjustment_requests',
          'time_account_policies',
          'time_periods',
        ]}
      />
      <SubpageHeader
        title="Zeitkonto"
        description="Abgeschlossene Monatswerte und nachvollziehbare Kontobewegungen."
      />
      {overview.success ? (
        <TimeAccountOverviewContent overview={overview.data} />
      ) : (
        <RegionLoadError title="Dein Zeitkonto konnte nicht geladen werden">
          Saldo und Monatswerte sind gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      )}
    </div>
  );
}

function TimeAccountOverviewContent({ overview }: { overview: TimeAccountOverview }) {
  return (
    <>
      {!overview.account ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Clock3 className="size-5" /> Dein Zeitkonto wurde noch nicht eröffnet. Die Zeiterfassung
            funktioniert unverändert weiter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aktueller Saldo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMinutes(overview.account.currentBalanceMinutes)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Eröffnet am {formatBerlin(overview.account.openedOn, 'numericDate')}
            </p>
          </CardContent>
        </Card>
      )}
      <section className="space-y-3">
        <h3 className="font-semibold">Monatsabschlüsse</h3>
        <TimeAccountPeriodList periods={overview.periods} />
        {overview.hasMorePeriods ? (
          <p className="text-sm text-muted-foreground">
            Hier stehen die letzten {OVERVIEW_PERIOD_LIMIT} Monate. Ältere Monate sind im Saldo enthalten.
          </p>
        ) : null}
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Kontobewegungen</h3>
        <TimeAccountEventList events={overview.events} />
        {overview.hasMoreEvents ? (
          <p className="text-sm text-muted-foreground">
            Hier stehen die letzten {OVERVIEW_EVENT_LIMIT} Kontobewegungen. Ältere Bewegungen sind im Saldo
            enthalten.
          </p>
        ) : null}
      </section>
    </>
  );
}
