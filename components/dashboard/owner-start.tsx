import Link from 'next/link';

import { SECTION_PRESENTATION } from '@/components/aufgaben/aufgaben-task-section';
import { OfficeStartSkeleton } from '@/components/loading-states/office-start-skeleton';
import { StaleRegion } from '@/components/shared/stale-region';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SectionError } from '@/components/ui/section-error';
import { OWNER_EXCEPTION_THRESHOLDS, groupOwnerExceptions } from '@/lib/attention/owner-exceptions';
import {
  attentionSectionHref,
  isPersonnelSection,
  type AttentionTaskSection,
  type AttentionTaskSectionKey,
} from '@/lib/attention/task-sections';
import type { AttentionOverview } from '@/lib/attention/types';
import { OverdueMaintenanceRegion, StartTaskSection, type OfficeStartRead } from './office-start-sections';

type OwnerAttention = Pick<AttentionOverview, 'tasks' | 'businessDate'>;

/** Why a section's tasks reached the owner, where its title alone does not say. */
const SECTION_NOTES: Partial<Record<AttentionTaskSectionKey, string>> = {
  callback: `Seit mehr als ${OWNER_EXCEPTION_THRESHOLDS.callbackOverdueWorkdays} Werktagen überfällig`,
  parkingReview: 'Wiedervorlage verstrichen',
  handover: `Seit mehr als ${OWNER_EXCEPTION_THRESHOLDS.handoverWaitingWorkdays} Werktagen nach Abschluss offen`,
};

/**
 * What needs the owner's decision, from Admin's Aufgaben (rules in
 * `lib/attention/owner-exceptions.ts`) and the überfällig maintenance. It
 * shares both reads with the office start below it.
 */
export function OwnerStartView({
  attention,
  maintenance,
}: {
  attention: OfficeStartRead<OwnerAttention>;
  maintenance: OfficeStartRead<number>;
}) {
  const sections = attention.data
    ? groupOwnerExceptions(attention.data.tasks, attention.data.businessDate)
    : null;
  const nothingOpen =
    sections?.length === 0 && !attention.isStale && maintenance.data === 0 && !maintenance.isStale;
  return (
    <section
      className="mx-auto max-w-3xl space-y-6"
      aria-labelledby="owner-start-heading"
      data-testid="owner-start"
    >
      <h2 id="owner-start-heading" className="text-sm font-semibold">
        Braucht deine Entscheidung
      </h2>
      {nothingOpen && (
        <EmptyState
          size="compact"
          title="Keine offenen Entscheidungen."
          description="Nichts wartet auf dich. Neue Ausnahmen erscheinen hier sofort."
        />
      )}
      <ExceptionRegion attention={attention} sections={sections} />
      <OverdueMaintenanceRegion maintenance={maintenance} testIdPrefix="owner-start" />
    </section>
  );
}

function ExceptionRegion({
  attention,
  sections,
}: {
  attention: OfficeStartRead<OwnerAttention>;
  sections: AttentionTaskSection[] | null;
}) {
  if (attention.isLoading) return <OfficeStartSkeleton />;
  if (!sections) {
    return (
      <SectionError onRetry={() => void attention.refresh()} retryPending={attention.isRefreshing}>
        Was deine Entscheidung braucht, konnte nicht geladen werden. Bitte versuche es erneut.
      </SectionError>
    );
  }
  if (sections.length === 0 && !attention.isStale) return null;
  return (
    <StaleRegion stale={attention.isStale} onRetry={attention.refresh} className="space-y-6">
      {sections.map((section) =>
        isPersonnelSection(section.key) ? (
          <ApprovalCountSection key={section.key} section={section} />
        ) : (
          <StartTaskSection
            key={section.key}
            section={section}
            testIdPrefix="owner-start"
            note={SECTION_NOTES[section.key]}
            partOfAufgaben
          />
        ),
      )}
    </StaleRegion>
  );
}

/** Approvals carry personnel data: the owner start shows only how many wait for Admin and opens them in Aufgaben. */
function ApprovalCountSection({ section }: { section: AttentionTaskSection }) {
  const { icon, title, testId } = SECTION_PRESENTATION[section.key];
  const count = section.tasks.length;
  const label =
    section.key === 'vacation'
      ? count === 1
        ? '1 Urlaubsantrag wartet auf deine Freigabe'
        : `${count} Urlaubsanträge warten auf deine Freigabe`
      : count === 1
        ? '1 Zeitkorrektur wartet auf deine Freigabe'
        : `${count} Zeitkorrekturen warten auf deine Freigabe`;
  return (
    <div className="space-y-2" data-testid={`owner-start-${testId}`}>
      <h3 className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
        <span className="tabular-nums">({count})</span>
      </h3>
      <Card className="gap-0 py-0">
        <ListRow asChild interactive variant="plain">
          <Link href={attentionSectionHref(section.key)} aria-label={`${label}: in Aufgaben öffnen`}>
            <p className="text-sm font-medium tabular-nums">{label}</p>
            <p className="text-xs text-muted-foreground">Du bist zuständig · Namen und Daten in Aufgaben</p>
          </Link>
        </ListRow>
      </Card>
    </div>
  );
}
