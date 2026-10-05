import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  formatDelegationDate,
  holderSourceLabel,
  personName,
} from '@/components/settings/responsibility-display';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { ORGANIZATION_RESPONSIBILITIES, RESPONSIBILITY_LABELS } from '@/lib/responsibilities/types';

export function OwnResponsibilitySummary({ data }: { data: ResponsibilitySettingsData }) {
  const ownRecordId = data.currentEmployeeRecordId;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meine Verantwortlichkeiten und Vertretungen</CardTitle>
        <CardDescription>Hier siehst du Freigaben und Vertretungen, die dich betreffen.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {ORGANIZATION_RESPONSIBILITIES.map((responsibility) => {
          const holder = data.effective[responsibility].holders.find(
            (candidate) => candidate.employeeRecordId === ownRecordId,
          );
          const relatedDelegations = data.delegations.filter(
            (delegation) =>
              delegation.responsibility === responsibility &&
              (delegation.delegatorEmployeeRecordId === ownRecordId ||
                delegation.substituteEmployeeRecordId === ownRecordId),
          );
          return (
            <section key={responsibility} className="space-y-2 border-b pb-5 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">{RESPONSIBILITY_LABELS[responsibility]}</h2>
                <Badge variant={holder ? 'secondary' : 'outline'}>
                  {holder ? 'Aktuell verantwortlich' : 'Nicht verantwortlich'}
                </Badge>
              </div>
              {holder ? <p className="text-sm text-muted-foreground">{holderSourceLabel(holder)}</p> : null}
              {relatedDelegations.map((delegation) => (
                <p key={delegation.id} className="text-sm text-muted-foreground">
                  {delegation.substituteEmployeeRecordId === ownRecordId
                    ? `Vertretung für ${personName(data.people, delegation.delegatorEmployeeRecordId)}`
                    : `Vertreten durch ${personName(data.people, delegation.substituteEmployeeRecordId)}`}{' '}
                  vom {formatDelegationDate(delegation.validFrom)} bis{' '}
                  {formatDelegationDate(delegation.validUntil)}
                </p>
              ))}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
