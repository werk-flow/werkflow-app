import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AppNotFoundPage() {
  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight">
          Seite nicht gefunden
        </h1>
        <p className="mt-3 text-muted-foreground">
          Die angeforderte Seite existiert nicht oder wurde verschoben.
          Überprüfe die eingegebene Adresse oder kehre zum Dashboard zurück.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild>
            <Link href="/dashboard">Zurück zum Dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
