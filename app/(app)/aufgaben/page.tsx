import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getCachedUser } from '@/lib/data/cached';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { AufgabenContent } from '@/components/aufgaben/aufgaben-content';

// P1-07: the one role-aware attention surface. Every role sees exactly what
// concerns them — approvals for responsibility holders, open requests for the
// office, decision notifications and own requests for the person. Items are
// derived live from the owning domains and deep-link there; nothing is
// decided on this page.
export default async function AufgabenPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) {
    redirect('/login');
  }

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

  if (!activeOrgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Aufgaben</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-xl font-bold sm:text-2xl">Aufgaben</h1>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <AufgabenContent />
      </div>
    </div>
  );
}
