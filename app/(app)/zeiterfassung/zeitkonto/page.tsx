import { Clock3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeAccountNav } from "@/components/zeiterfassung/time-account-nav";
import {
  getTimeAccountAccess,
  getTimeAccountOverview,
} from "@/lib/time-accounts/actions";
import {
  formatMinutes,
  formatPeriod,
  PERIOD_STATE_LABELS,
} from "@/lib/time-accounts/presentation";

export default async function TimeAccountPage() {
  const [overview, access] = await Promise.all([
    getTimeAccountOverview(),
    getTimeAccountAccess(),
  ]);
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Zeitkonto</h1>
          <p className="text-sm text-muted-foreground">
            Abgeschlossene Monatswerte und nachvollziehbare Kontobewegungen.
          </p>
        </div>
        <TimeAccountNav {...access} currentPath="/zeiterfassung/zeitkonto" />
      </div>
      {!overview.account ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Clock3 className="size-5" /> Ihr Zeitkonto wurde noch nicht
            eröffnet. Die Zeiterfassung funktioniert unverändert weiter.
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
              Eröffnet am{" "}
              {new Intl.DateTimeFormat("de-DE", {
                timeZone: "Europe/Berlin",
              }).format(new Date(`${overview.account.openedOn}T12:00:00Z`))}
            </p>
          </CardContent>
        </Card>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Monatsabschlüsse</h2>
        <div className="overflow-hidden rounded-lg border bg-card">
          {overview.periods.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Noch keine abgeschlossenen oder vorbereiteten Perioden.
            </p>
          ) : (
            overview.periods.map((period) => (
              <div
                key={period.id}
                className="grid gap-2 border-b p-4 last:border-b-0 sm:grid-cols-5"
              >
                <div className="font-medium capitalize">
                  {formatPeriod(period.startDate)}
                </div>
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
                  {PERIOD_STATE_LABELS[
                    period.state as keyof typeof PERIOD_STATE_LABELS
                  ] ?? period.state}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Kontobewegungen</h2>
        <div className="overflow-hidden rounded-lg border bg-card">
          {overview.events.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Noch keine Kontobewegungen.
            </p>
          ) : (
            overview.events.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-4 border-b p-4 last:border-b-0"
              >
                <div>
                  <p className="font-medium">{event.reason}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Intl.DateTimeFormat("de-DE", {
                      timeZone: "Europe/Berlin",
                    }).format(new Date(`${event.effectiveDate}T12:00:00Z`))}
                  </p>
                </div>
                <span className="font-medium tabular-nums">
                  {formatMinutes(event.minutes)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
