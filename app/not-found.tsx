import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-lg rounded-lg border bg-card p-8 text-center shadow-sm">
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
