import Link from 'next/link';

import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';

/** An unknown address inside the app: the shell, the sidebar and the clock button stay usable. */
export default function AppNotFoundPage() {
  return (
    <PageShell>
      <PageHeader title="Seite nicht gefunden" />
      <PageBody maxWidth="content">
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Die angeforderte Seite existiert nicht oder wurde verschoben. Überprüfe die eingegebene Adresse
            oder kehre zum Dashboard zurück.
          </p>
          <Button asChild>
            <Link href="/dashboard">Zurück zum Dashboard</Link>
          </Button>
        </div>
      </PageBody>
    </PageShell>
  );
}
