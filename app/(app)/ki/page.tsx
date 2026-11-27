import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { KiChat } from '@/components/ki/ki-chat';
import { KiChatSkeleton } from '@/components/loading-states/ki-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { TextLink } from '@/components/ui/text-link';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import { readAiOrganizationSwitch } from '@/lib/ai/settings';
import { getAiThreadPage, getAiThreadWindow } from '@/lib/ai/thread-reads';
import { resolveActionContext } from '@/lib/org/action-context';
import { uuidSchema } from '@/lib/validation/uuid';

type SearchParams = Promise<{ chat?: string | string[] }>;

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <PageBody maxWidth="content">
      <p className="text-sm text-muted-foreground">{children}</p>
    </PageBody>
  );
}

const loadError = (
  <PageBody maxWidth="content">
    <RegionLoadError title={`${AI_PRODUCT_NAME} konnte nicht geladen werden`}>
      Die Chats sind gerade nicht erreichbar. Versuch es in einem Moment noch einmal.
    </RegionLoadError>
  </PageBody>
);

// One page for the new chat (`/ki`) and every thread (`/ki?chat=<id>`):
// switching threads changes only the address, so the page and its composer stay.
async function KiData({ searchParams }: { searchParams: SearchParams }) {
  const { chat } = await searchParams;
  const parsed = chat === undefined ? null : uuidSchema.safeParse(chat);
  if (parsed?.success === false) notFound();
  const threadId = parsed?.success ? parsed : null;
  const auth = await resolveActionContext();
  if (!auth.success) return loadError;
  const { orgId, userId, role } = auth.context;
  const access = await readAiOrganizationSwitch(orgId);
  if (access === 'load_failed') return loadError;
  if (!access.released)
    return <Notice>{AI_PRODUCT_NAME} ist für deinen Betrieb noch nicht freigeschaltet.</Notice>;
  if (!access.enabled)
    return (
      <Notice>
        {AI_PRODUCT_NAME} ist in deinem Betrieb ausgeschaltet.{' '}
        {role === 'admin' ? (
          <TextLink href="/einstellungen/organisation">In den Einstellungen einschalten</TextLink>
        ) : (
          'Ein Admin kann sie in den Einstellungen einschalten.'
        )}
      </Notice>
    );
  const [threads, window] = await Promise.all([
    getAiThreadPage({ organizationId: orgId }),
    threadId ? getAiThreadWindow({ organizationId: orgId, threadId: threadId.data }) : null,
  ]);
  // A thread this person does not have here, such as the last one after an organization switch,
  // opens the new chat; the page then drops the address.
  const missing = window !== null && !window.success && window.error === 'not_found';
  if (!threads.success || (window && !window.success && !missing)) return loadError;
  return (
    <KiChat
      organizationId={orgId}
      userId={userId}
      initialThreadId={threadId && !missing ? threadId.data : null}
      initialThreads={{ threads: threads.threads, hasMore: threads.hasMore }}
      initialWindow={window?.success ? window.window : null}
    />
  );
}

export default function KiPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageShell>
      <PageHeader title={AI_PRODUCT_NAME} />
      <Suspense fallback={<KiChatSkeleton />}>
        <KiData searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}
