'use client';

import { Award, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import {
  getCapabilityKindLabel,
  type OwnQualificationProfile,
} from '@/lib/qualifications/types';

export function OwnQualificationOverview({
  profile,
}: {
  profile: OwnQualificationProfile | null;
}) {
  useRealtimeRouterRefresh({
    tables: [
      'teams',
      'team_memberships',
      'organization_capabilities',
      'employee_capabilities',
    ],
  });
  const today = getBusinessTodayIso();
  const formatDate = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString('de-DE');
  if (!profile) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Für dein Konto ist noch kein Mitarbeiterdatensatz verknüpft.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Meine Teams</h2>
        </div>
        {profile.teamNames.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Du bist aktuell keinem Team zugeordnet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profile.teamNames.map((name) => (
              <Badge key={name} variant="secondary">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Award className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Meine Qualifikationen</h2>
        </div>
        {profile.capabilities.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Noch keine Qualifikationen hinterlegt.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {profile.capabilities.map(({ definition, record }) => {
              const expired = Boolean(
                record.validUntil && record.validUntil < today
              );
              const future = record.validFrom > today;
              return (
                <Card key={record.id} className="gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{definition.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {getCapabilityKindLabel(definition.kind)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        expired
                          ? 'destructive'
                          : future
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {expired
                        ? 'Abgelaufen'
                        : future
                          ? 'Noch nicht gültig'
                          : 'Gültig'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Gültig ab {formatDate(record.validFrom)}
                    {record.validUntil ? ' bis ' + formatDate(record.validUntil) : ''}
                  </p>
                  {definition.kind === 'certification' && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">
                        {record.confirmationStatus === 'confirmed'
                          ? 'Intern bestätigt'
                          : 'Intern nicht bestätigt'}
                      </Badge>
                      <Badge variant="secondary">
                        Nachweis:{' '}
                        {record.evidenceState === 'received'
                          ? 'erhalten'
                          : record.evidenceState === 'pending'
                            ? 'ausstehend'
                            : 'nicht erforderlich'}
                      </Badge>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Die Angaben dienen der internen Planung. Sie sind keine rechtliche
        Bewertung deiner Einsatzberechtigung.
      </p>
    </div>
  );
}
