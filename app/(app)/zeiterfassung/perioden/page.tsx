import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { TimePeriodPrepareForm } from '@/components/zeiterfassung/time-period-prepare-form';
import { getTimeAccountAccess } from '@/lib/time-accounts/actions';
import { formatPeriod, PERIOD_STATE_LABELS } from '@/lib/time-accounts/presentation';
import { formatGermanDate } from '@/lib/utils';
import { getTimePeriods, type TimePeriodListItem } from '@/lib/time-accounts/queries';
import { TIME_PERIOD_LIST_LIVE_TABLES } from '@/lib/time-accounts/live-tables';

function defaultMonth(): string {
  const berlinToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
  }).format(new Date());
  const date = new Date(`${berlinToday.slice(0, 7)}-01T12:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

export default async function TimePeriodsPage() {
  const [periods, access] = await Promise.all([getTimePeriods(), getTimeAccountAccess()]);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <LiveRouteRefresh tables={TIME_PERIOD_LIST_LIVE_TABLES} />
      <SubpageHeader
        title="Abrechnungsperioden"
        description="Jeder Kalendermonat wird vorbereitet, geprüft und dann für die Lohnabrechnung abgeschlossen."
      />
      {access.canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monat vorbereiten oder neu berechnen</CardTitle>
          </CardHeader>
          <CardContent>
            <TimePeriodPrepareForm initialMonth={defaultMonth()} />
          </CardContent>
        </Card>
      ) : null}
      {!access.canManage && !access.managementReadFailed ? (
        <p className="text-sm text-muted-foreground">
          Diese Übersicht ist für Büro- und Freigaberollen bestimmt.
        </p>
      ) : null}
      {access.managementReadFailed || (access.canManage && !periods.success) ? (
        <RegionLoadError title="Die Perioden konnten nicht geladen werden">
          Die Übersicht ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      ) : null}
      {access.canManage && periods.success ? <TimePeriodList periods={periods.data} /> : null}
    </div>
  );
}

function TimePeriodList({ periods }: { periods: TimePeriodListItem[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {periods.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">Noch keine Periode vorbereitet.</p>
      ) : (
        periods.map((period) => (
          <div
            key={period.id}
            className="grid items-center gap-3 border-b p-4 last:border-b-0 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]"
          >
            <div>
              <p className="font-medium capitalize">{formatPeriod(period.startDate)}</p>
              <p className="text-xs text-muted-foreground">
                {formatGermanDate(period.startDate)} – {formatGermanDate(period.endDate)}
              </p>
            </div>
            <div className="text-sm">
              {PERIOD_STATE_LABELS[period.state as keyof typeof PERIOD_STATE_LABELS] ?? period.state}
            </div>
            <div className="text-sm">{period.employeeCount} Mitarbeitende</div>
            <div className="text-sm">
              {period.findingCount} {period.findingCount === 1 ? 'Hinweis' : 'Hinweise'}
              {period.blockingCount > 0 ? ` · ${period.blockingCount} blockierend` : ''}
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/zeiterfassung/perioden/${period.id}`}>Öffnen</Link>
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
