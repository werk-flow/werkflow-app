'use client';

import { PageBody, PageShell } from '@/components/shared/page-shell';
import { SectionError } from '@/components/ui/section-error';

/**
 * Failure state of one authenticated page. The boundary sits inside the app
 * layout, so the sidebar and the clock button stay usable and the user can
 * move on or retry. `app/error.tsx` remains the boundary for a failure of the
 * layout itself. Next masks the message in production; nothing sensitive renders.
 */
export default function AppPageError({ reset }: { reset: () => void }) {
  return (
    <PageShell>
      <PageBody maxWidth="content">
        <SectionError title="Diese Seite konnte nicht geladen werden" onRetry={reset}>
          Beim Laden ist ein Fehler aufgetreten. Deine Daten sind davon nicht betroffen. Versuche es erneut
          oder wechsle über die Navigation in einen anderen Bereich.
        </SectionError>
      </PageBody>
    </PageShell>
  );
}
