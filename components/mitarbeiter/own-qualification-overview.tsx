'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Award, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { getCapabilityKindLabel, type OwnQualificationProfile } from '@/lib/qualifications/types';
import { formatBerlin } from '@/lib/utils';

type OwnQualificationCardProps = OwnQualificationProfile['capabilities'][number] & {
  today: string;
  formatDate: (value: string) => string;
};

function OwnQualificationCard({ definition, record, today, formatDate }: OwnQualificationCardProps) {
  const expired = Boolean(record.validUntil && record.validUntil < today);
  const future = record.validFrom > today;
  return (
    <Card className="gap-2 p-4" data-testid="own-qualification-card" data-capability-name={definition.name}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{definition.name}</h3>
          <p className="text-xs text-muted-foreground">{getCapabilityKindLabel(definition.kind)}</p>
        </div>
        <Badge variant={expired ? 'destructive' : future ? 'secondary' : 'outline'}>
          {expired ? 'Abgelaufen' : future ? 'Noch nicht gültig' : 'Gültig'}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Gültig ab {formatDate(record.validFrom)}
        {record.validUntil ? ' bis ' + formatDate(record.validUntil) : ''}
      </p>
      {definition.kind === 'certification' && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">
            {record.confirmationStatus === 'confirmed' ? 'Intern bestätigt' : 'Intern nicht bestätigt'}
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
}

export function OwnQualificationOverview({ profile }: { profile: OwnQualificationProfile | null }) {
  const router = useRouter();
  const refreshAtBusinessDayChange = useCallback(() => router.refresh(), [router]);
  useBusinessDayRefresh(refreshAtBusinessDayChange);
  useRealtimeRouterRefresh({
    tables: ['teams', 'team_memberships', 'organization_capabilities', 'employee_capabilities'],
  });
  const today = getBusinessTodayIso();
  const formatDate = (value: string) => formatBerlin(value, 'numericDate');
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
          <p className="text-sm text-muted-foreground">Du bist aktuell keinem Team zugeordnet.</p>
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
          <EmptyState size="compact" title="Noch keine Qualifikationen hinterlegt." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {profile.capabilities.map(({ definition, record }) => (
              <OwnQualificationCard
                key={record.id}
                definition={definition}
                record={record}
                today={today}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Die Angaben dienen der internen Planung. Sie sind keine rechtliche Bewertung deiner
        Einsatzberechtigung.
      </p>
    </div>
  );
}
