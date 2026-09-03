import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  closeTimePeriod,
  decidePeriodFinding,
  downloadPayrollExport,
  generatePayrollExport,
  getTimeAccountAccess,
  getTimePeriodDetail,
  reopenTimePeriod,
} from "@/lib/time-accounts/actions";
import {
  FINDING_DECISION_LABELS,
  FINDING_LABELS,
  formatMinutes,
  formatPeriod,
  PAYROLL_EXPORT_STATE_LABELS,
  PERIOD_STATE_LABELS,
} from "@/lib/time-accounts/presentation";

function FindingIcon({ severity }: { severity: string }) {
  if (severity === "close_blocked")
    return (
      <AlertTriangle aria-hidden="true" className="size-4 text-destructive" />
    );
  if (severity === "approval_required")
    return (
      <AlertTriangle aria-hidden="true" className="size-4 text-yellow-600" />
    );
  return <Info aria-hidden="true" className="size-4 text-muted-foreground" />;
}

export default async function TimePeriodDetailPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const [detail, access] = await Promise.all([
    getTimePeriodDetail(periodId),
    getTimeAccountAccess(),
  ]);
  if (!detail) notFound();
  const unresolvedApprovalCount = detail.findings.filter(
    (finding) =>
      finding.severity === "approval_required" &&
      finding.decision !== "approved",
  ).length;
  const blockedCount = detail.findings.filter(
    (finding) => finding.severity === "close_blocked",
  ).length;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight capitalize">
          {formatPeriod(detail.period.startDate)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {detail.period.startDate} – {detail.period.endDate} ·{" "}
          {PERIOD_STATE_LABELS[
            detail.period.state as keyof typeof PERIOD_STATE_LABELS
          ] ?? detail.period.state}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Mitarbeitende
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {detail.results.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Freigaben offen
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {unresolvedApprovalCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Abschluss blockiert
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {blockedCount}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Monatswerte</h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Mitarbeiter/in
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Soll
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Gewertet
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Differenz
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Schlusssaldo
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Sollquelle
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.results.map((result) => (
                <tr
                  key={result.employeeRecordId}
                  className="border-b last:border-b-0"
                >
                  <td className="px-4 py-3 font-medium">
                    {result.employeeName}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatMinutes(result.targetMinutes)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatMinutes(result.creditedMinutes)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatMinutes(result.periodDeltaMinutes)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatMinutes(result.closingBalanceMinutes)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {result.authoritativeTargets ? "Arbeitsplan" : "Ersatzwert"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Prüfhinweise</h2>
        <div className="space-y-2">
          {detail.findings.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              Keine Prüfhinweise.
            </p>
          ) : (
            detail.findings.map((finding) => (
              <div
                key={finding.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <FindingIcon severity={finding.severity} />
                  <div>
                    <p className="font-medium">
                      {FINDING_LABELS[
                        finding.kind as keyof typeof FINDING_LABELS
                      ] ?? finding.kind}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {finding.employeeName ?? "Organisation"} ·{" "}
                      {finding.severity === "close_blocked"
                        ? "muss vor dem Abschluss behoben werden"
                        : finding.severity === "approval_required"
                          ? "Freigabe erforderlich"
                          : "Information"}
                      {finding.decision
                        ? ` · ${FINDING_DECISION_LABELS[finding.decision as keyof typeof FINDING_DECISION_LABELS] ?? finding.decision}`
                        : ""}
                    </p>
                  </div>
                </div>
                {finding.severity === "approval_required" &&
                finding.decision !== "approved" ? (
                  <form
                    action={decidePeriodFinding}
                    className="flex items-end gap-2"
                  >
                    <input type="hidden" name="periodId" value={periodId} />
                    <input type="hidden" name="findingId" value={finding.id} />
                    <Input
                      name="reason"
                      defaultValue="Geprüft"
                      aria-label={`Begründung für ${
                        FINDING_LABELS[
                          finding.kind as keyof typeof FINDING_LABELS
                        ] ?? finding.kind
                      }`}
                      className="h-9 w-40"
                    />
                    <Button
                      name="decision"
                      value="approved"
                      size="sm"
                      data-testid={`approve-finding-${finding.id}`}
                    >
                      <CheckCircle2 className="size-4" />
                      Freigeben
                    </Button>
                    <Button
                      name="decision"
                      value="rejected"
                      variant="outline"
                      size="sm"
                    >
                      Ablehnen
                    </Button>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Periodenabschluss</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {detail.period.state !== "closed" ? (
            <form action={closeTimePeriod}>
              <input type="hidden" name="periodId" value={periodId} />
              <Button
                type="submit"
                disabled={
                  !detail.calculation ||
                  blockedCount > 0 ||
                  unresolvedApprovalCount > 0
                }
              >
                Monat abschließen
              </Button>
            </form>
          ) : null}
          {detail.period.state === "closed" && access.isAdmin ? (
            <form action={reopenTimePeriod} className="flex gap-2">
              <input type="hidden" name="periodId" value={periodId} />
              <Input
                name="reason"
                defaultValue="Korrektur erforderlich"
                required
              />
              <Button type="submit" variant="outline">
                Wieder öffnen
              </Button>
            </form>
          ) : null}
          {!detail.calculation ? (
            <p className="text-sm text-muted-foreground">
              Die Periode muss zuerst vorbereitet werden.
            </p>
          ) : null}
          {detail.calculation && blockedCount > 0 ? (
            <p className="text-sm text-destructive" role="status">
              {blockedCount} blockierende Hinweise müssen zuerst behoben werden.
            </p>
          ) : null}
          {detail.calculation && unresolvedApprovalCount > 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              {unresolvedApprovalCount} Freigaben sind noch offen.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lohnexport</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {detail.period.state === "closed" ? (
            <form action={generatePayrollExport}>
              <input type="hidden" name="periodId" value={periodId} />
              <Button type="submit">Deterministisches ZIP erzeugen</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Der Export wird nach dem Abschluss freigeschaltet.
            </p>
          )}
          {detail.exports.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 border-t pt-3 text-sm"
            >
              <span>
                Version {item.version} ·{" "}
                {PAYROLL_EXPORT_STATE_LABELS[
                  item.state as keyof typeof PAYROLL_EXPORT_STATE_LABELS
                ] ?? item.state}
              </span>
              {item.state === "ready" ? (
                <form action={downloadPayrollExport}>
                  <input type="hidden" name="exportId" value={item.id} />
                  <Button variant="outline" size="sm">
                    ZIP herunterladen
                  </Button>
                </form>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
