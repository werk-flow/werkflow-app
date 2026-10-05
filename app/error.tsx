'use client';

import { StandaloneScreen } from '@/components/shared/standalone-screen';
import { SectionError } from '@/components/ui/section-error';

/**
 * The visible failure state of a render that could not complete, such as an
 * identity check against an unreachable Auth service (`AuthUnavailableError`).
 * Availability failures fail closed here instead of pretending the user is
 * signed out. Next masks the message in production; nothing sensitive renders.
 */
export default function RenderErrorPage({ reset }: { reset: () => void }) {
  return (
    <StandaloneScreen>
      <SectionError className="w-full max-w-lg" title="Die Seite konnte nicht geladen werden" onRetry={reset}>
        Ein Dienst hat nicht geantwortet. Deine Daten und deine Anmeldung sind davon nicht betroffen. Versuche
        es in einem Moment erneut.
      </SectionError>
    </StandaloneScreen>
  );
}
