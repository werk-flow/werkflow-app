import Link from 'next/link';
import { Award, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type {
  PersonnelQualificationSummary,
} from '@/lib/qualifications/types';

export type PersonnelQualificationSummaryData = PersonnelQualificationSummary;

export function PersonnelQualificationSummary({
  data,
}: {
  data: PersonnelQualificationSummaryData | null;
}) {
  if (!data) {
    return (
      <Card className="p-4">
        <p role="alert" className="text-sm text-destructive">
          Teams und Qualifikationen konnten nicht geladen werden.
        </p>
      </Card>
    );
  }
  const formatDate = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString('de-DE');
  return (
    <Card className="gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Teams & Qualifikationen</h2>
          <p className="text-xs text-muted-foreground">
            Operative Angaben für die Planung.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/mitarbeiter">Verwalten</Link>
        </Button>
      </div>
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Users className="size-3.5" />
          Teams
        </p>
        {data.teamNames.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {data.teamNames.map((name) => (
              <Badge key={name} variant="secondary">
                {name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Keine aktuelle Teamzuordnung.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Award className="size-3.5" />
          Einträge
        </p>
        {data.entries.length > 0 ? (
          <div className="space-y-2">
            {data.entries.map(({ definition, record }) => (
              <div key={record.id} className="rounded-md bg-muted/40 px-3 py-2">
                <p className="text-sm font-medium">{definition.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(record.validFrom)}
                  {record.validUntil ? ' – ' + formatDate(record.validUntil) : ''}
                  {definition.kind === 'certification'
                    ? ' · ' +
                      (record.confirmationStatus === 'confirmed'
                        ? 'intern bestätigt'
                        : 'nicht bestätigt')
                    : ''}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Keine Qualifikationen hinterlegt.
          </p>
        )}
      </div>
    </Card>
  );
}
