import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StarterTimePolicyForm } from '@/components/zeiterfassung/time-account-settings-forms';
import type { PolicyVersionLine } from '@/lib/time-accounts/policy-versions';
import type { TimeAccountSettingsData } from '@/lib/time-accounts/queries';
import { formatGermanDate } from '@/lib/utils';

/** When a version applies: its span, or the version that replaced it on its start day. */
function versionSpan(line: PolicyVersionLine): string {
  const from = formatGermanDate(line.effectiveFrom);
  if (line.replacedBy !== null) return `ab ${from}, am selben Tag durch Version ${line.replacedBy} ersetzt`;
  return line.validUntil ? `${from} bis ${formatGermanDate(line.validUntil)}` : `ab ${from}`;
}

function PolicyVersionList({ policy }: { policy: TimeAccountSettingsData['policies'][number] }) {
  return (
    <section className="space-y-1" aria-label={`Versionen von ${policy.name}`}>
      <h3 className="text-sm font-medium">
        {policy.name}
        {policy.isDefault ? ' · Standard' : ''}
      </h3>
      <ul className="text-sm">
        {policy.versions.map((line) => (
          <li
            key={line.version}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b py-2 last:border-b-0"
          >
            <span>Version {line.version}</span>
            <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
              {versionSpan(line)}
              {line.status === 'in_force' && <Badge variant="success">Gilt heute</Badge>}
              {line.status === 'planned' && <Badge>Geplant</Badge>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The working-time rules: every version of every policy with the span it
 * applies on, the one in force today marked, and the form for the next one.
 */
export function TimePolicyCard({
  policies,
  suggestedStartDate,
}: {
  policies: TimeAccountSettingsData['policies'];
  suggestedStartDate: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Arbeitszeitregel</CardTitle>
        <CardDescription>
          Der Startsatz nutzt die sechs Aktivitätsarten und 0, 50 oder 100 Prozent. Weitere Sätze und
          Prozentwerte können später ergänzt werden. Jeder Tag gilt nach der Version mit dem spätesten Beginn
          bis zu diesem Tag.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {policies.map((policy) => (
          <PolicyVersionList key={policy.id} policy={policy} />
        ))}
        <StarterTimePolicyForm startDate={suggestedStartDate} />
      </CardContent>
    </Card>
  );
}
