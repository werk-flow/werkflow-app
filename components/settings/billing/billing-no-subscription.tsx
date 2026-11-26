import Link from 'next/link';
import { CreditCard } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/** An organization without a WerkFlow subscription yet, such as a pilot organization. */
export function BillingNoSubscription() {
  return (
    <EmptyState
      icon={CreditCard}
      title="Noch kein Abo"
      description="Deine Organisation nutzt WerkFlow ohne Abo. Wenn du ein Abo abschließt, findest du hier deine Rechnungen, die nächste Zahlung und die Kündigung."
      action={
        <Button asChild>
          <Link href="/upgrade">Abo abschließen</Link>
        </Button>
      }
      className="rounded-lg border bg-card shadow-xs"
    />
  );
}
