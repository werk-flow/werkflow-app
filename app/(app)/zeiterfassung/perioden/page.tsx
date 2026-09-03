import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { MonthPicker } from "@/components/ui/month-picker";
import {
  getTimeAccountAccess,
  getTimePeriods,
  prepareTimePeriod,
} from "@/lib/time-accounts/actions";
import {
  formatPeriod,
  PERIOD_STATE_LABELS,
} from "@/lib/time-accounts/presentation";

function defaultMonth(): string {
  const berlinToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
  }).format(new Date());
  const date = new Date(`${berlinToday.slice(0, 7)}-01T12:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

export default async function TimePeriodsPage() {
  const [periods, access] = await Promise.all([
    getTimePeriods(),
    getTimeAccountAccess(),
  ]);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          Abrechnungsperioden
        </h2>
        <p className="text-sm text-muted-foreground">
          Kalendermonate in Europe/Berlin. Andere Stichtage bleiben eine
          spätere Erweiterung.
        </p>
      </div>
      {access.canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Monat vorbereiten oder neu berechnen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={prepareTimePeriod}
              className="flex flex-wrap items-end gap-3"
            >
              <Field label="Monat" htmlFor="time-period-month" required className="w-40">
                <MonthPicker
                  id="time-period-month"
                  name="month"
                  defaultValue={defaultMonth()}
                />
              </Field>
              <Button type="submit">Periode vorbereiten</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Diese Übersicht ist für Büro- und Freigaberollen bestimmt.
        </p>
      )}
      {access.canManage ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          {periods.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Noch keine Periode vorbereitet.
            </p>
          ) : (
            periods.map((period) => (
              <div
                key={period.id}
                className="grid items-center gap-3 border-b p-4 last:border-b-0 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]"
              >
                <div>
                  <p className="font-medium capitalize">
                    {formatPeriod(period.startDate)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {period.startDate} – {period.endDate}
                  </p>
                </div>
                <div className="text-sm">
                  {PERIOD_STATE_LABELS[
                    period.state as keyof typeof PERIOD_STATE_LABELS
                  ] ?? period.state}
                </div>
                <div className="text-sm">
                  {period.employeeCount} Mitarbeitende
                </div>
                <div className="text-sm">
                  {period.findingCount} Hinweise
                  {period.blockingCount > 0
                    ? ` · ${period.blockingCount} blockierend`
                    : ""}
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/zeiterfassung/perioden/${period.id}`}>
                    Öffnen
                  </Link>
                </Button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
