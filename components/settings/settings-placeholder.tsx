import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRoleLabel } from '@/lib/roles';

type SettingsPlaceholderProps = {
  title: string;
  description: string;
  activeRole?: 'admin' | 'buero' | 'employee' | null;
};

export function SettingsPlaceholder({
  title,
  description,
  activeRole,
}: SettingsPlaceholderProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Dieser Bereich ist als eigener Einstellungsbereich bereits vorbereitet, wird aber
            erst mit der nächsten passenden Funktionalität befüllt.
          </p>
          <p>
            Sobald hier echte Optionen hinzukommen, gelten sie organisationsweit. Admins werden
            sie bearbeiten können, während Büro-Nutzer sie je nach Bereich nur einsehen oder
            teilweise mitverwenden.
          </p>
          {activeRole ? (
            <p>
              Aktive Rolle in der aktuellen Organisation: <span className="font-medium text-foreground">{getRoleLabel(activeRole)}</span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Geplanter Ausbau</CardTitle>
          <CardDescription>
            Dieser Platzhalter reserviert den Bereich für spätere, echte Einstellungen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Keine inaktiven Toggle-Elemente, keine Scheineinstellungen und keine toten Controls.</p>
          <p>Die Seite bleibt trotzdem schon jetzt auffindbar, damit die Struktur der App mitwächst.</p>
        </CardContent>
      </Card>
    </div>
  );
}
