import { Clock3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { formatMinutes, formatPeriod, PERIOD_STATE_LABELS } from '@/lib/time-accounts/presentation';
import {
  getTimeAccountOverview,
  OVERVIEW_EVENT_LIMIT,
  OVERVIEW_PERIOD_LIMIT,
  type TimeAccountOverview,
} from '@/lib/time-accounts/queries';

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
              Eröffnet am{' '}
              {new Intl.DateTimeFormat('de-DE', {
                timeZone: 'Europe/Berlin',
              }).format(new Date(`${overview.account.openedOn}T12:00:00Z`))}
            </p>
          </CardContent>
        </Card>
      )}
      <section className="space-y-3">
        <h3 className="font-semibold">Monatsabschlüsse</h3>
        <div className="overflow-hidden rounded-lg border bg-card">
          {overview.periods.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Noch keine abgeschlossenen oder vorbereiteten Perioden.
            </p>
          ) : (
            overview.periods.map((period) => (
              <div key={period.id} className="grid gap-2 border-b p-4 last:border-b-0 sm:grid-cols-5">
                <div className="font-medium capitalize">{formatPeriod(period.startDate)}</div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Soll </span>
                  {formatMinutes(period.targetMinutes)}
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Gewertet </span>
                  {formatMinutes(period.creditedMinutes)}
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Differenz </span>
                  {formatMinutes(period.deltaMinutes)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {PERIOD_STATE_LABELS[period.state as keyof typeof PERIOD_STATE_LABELS] ?? period.state}
                </div>
              </div>
            ))
          )}
        </div>
        {overview.hasMorePeriods ? (
          <p className="text-sm text-muted-foreground">
            Hier stehen die letzten {OVERVIEW_PERIOD_LIMIT} Monate. Ältere Monate sind im Saldo enthalten.
          </p>
        ) : null}
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Kontobewegungen</h3>
        <div className="overflow-hidden rounded-lg border bg-card">
          {overview.events.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Noch keine Kontobewegungen.</p>
          ) : (
            overview.events.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-4 border-b p-4 last:border-b-0"
              >
                <div>
                  <p className="font-medium">{event.reason}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Intl.DateTimeFormat('de-DE', {
                      timeZone: 'Europe/Berlin',
                    }).format(new Date(`${event.effectiveDate}T12:00:00Z`))}
                  </p>
                </div>
                <span className="font-medium tabular-nums">{formatMinutes(event.minutes)}</span>
              </div>
            ))
          )}
        </div>
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
