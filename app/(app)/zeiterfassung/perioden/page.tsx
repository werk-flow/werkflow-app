import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { TimePeriodList } from '@/components/zeiterfassung/time-period-list';
import { TimePeriodPrepareForm } from '@/components/zeiterfassung/time-period-prepare-form';
import { getTimeAccountAccess } from '@/lib/time-accounts/actions';
import { addLocalMonthsClamped, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { getTimePeriods } from '@/lib/time-accounts/queries';
import { TIME_PERIOD_LIST_LIVE_TABLES } from '@/lib/time-accounts/live-tables';

/** The Berlin month before the current one, `YYYY-MM`: the period an office closes next. */
function defaultMonth(): string {
  return addLocalMonthsClamped(`${getBusinessTodayIso().slice(0, 7)}-01`, -1).slice(0, 7);
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
