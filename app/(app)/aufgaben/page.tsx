import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getCachedUser } from '@/lib/data/cached';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { AufgabenContent } from '@/components/aufgaben/aufgaben-content';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';

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
      <PageShell>
        <PageHeader title="Aufgaben" />
        <PageBody>
          <p className="text-muted-foreground">
            Bitte wähle zuerst eine Organisation aus.
          </p>
        </PageBody>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader title="Aufgaben" />
      <PageBody>
        <AufgabenContent />
      </PageBody>
    </PageShell>
  );
}
