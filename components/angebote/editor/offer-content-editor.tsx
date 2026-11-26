'use client';

import { Plus, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { move } from '@/components/arbeitsvorlagen/work-template-editor-shared';
import { InvoiceTotals } from '@/components/rechnungen/invoice-totals';
import { SectionTitle } from '@/components/shared/section-title';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { saveOfferContent } from '@/lib/offers/actions';
import {
  contentFormOf,
  liveContentAmounts,
  parseContentForm,
  type SectionForm,
} from '@/lib/offers/content-form';
import type { OfferAmounts } from '@/lib/offers/amounts';
import type { OfferDetail } from '@/lib/offers/types';
import { ownWrites } from '@/lib/realtime/own-writes';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { OfferSectionFields } from './offer-section-fields';

const SAVE_FAILED = 'Die Positionen konnten nicht gespeichert werden. Versuche es erneut.';
const CONTENT_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  save_failed: SAVE_FAILED,
  invalid_input: 'Eine Angabe passt nicht. Prüfe Mengen und Preise und speichere erneut.',
  offer_changed:
    'Jemand hat die Positionen gerade geändert. Lade die aktuelle Fassung mit „Neu laden“, deine Eingaben gehen dabei verloren.',
  offer_not_editable: 'Das Angebot ist kein Entwurf mehr. Seine Positionen kannst du nicht mehr ändern.',
  offer_not_found: 'Das Angebot gibt es nicht mehr.',
};

type Draft = {
  sections: SectionForm[];
  /** The content version the text was filled from; the save names it. */
  baseVersion: number;
  /** Typed since the last load, or not yet saved. */
  edited: boolean;
  /** One per change: only a repeat of the same press answers with the first save. */
  attemptKey: string;
};

function loaded(offer: OfferDetail): Draft {
  return {
    sections: contentFormOf(offer.sections),
    baseVersion: offer.contentVersion,
    edited: false,
    attemptKey: crypto.randomUUID(),
  };
}

/**
 * The text of the editor. Newer content replaces it while nothing is typed;
 * with own changes it waits for „Neu laden“. A save leaves the text unedited
 * at its base version, so the page's render of the saved content replaces it
 * as stored, whether it arrives before or after the answer. While the own
 * save runs, its rendered answer is no other session's.
 */
function useContentDraft(offer: OfferDetail, saving: boolean) {
  const [draft, setDraft] = useState(() => loaded(offer));
  const newer = offer.contentVersion > draft.baseVersion;
  if (newer && !draft.edited) setDraft(loaded(offer));
  return {
    draft,
    newerElsewhere: newer && draft.edited && !saving,
    edit: (sections: SectionForm[]) =>
      setDraft({ ...draft, sections, edited: true, attemptKey: crypto.randomUUID() }),
    saved: () => setDraft({ ...draft, edited: false, attemptKey: crypto.randomUUID() }),
    reload: () => setDraft(loaded(offer)),
  };
}

/**
 * „Titel und Positionen“ of an offer in „Entwurf“. The amounts follow every
 * keystroke through the same rule the server stores them by; „Speichern“
 * sends the whole content against the content version it was filled from,
 * and a save another session made meanwhile refuses it instead of being
 * overwritten.
 */
export function OfferContentEditor({ offer }: { offer: OfferDetail }) {
  const { showBanner } = useBanner();
  const router = useRouter();
  // The saved content is on screen once the page renders the content version the save answered.
  const settle = useSettleOnChange(offer.contentVersion);
  const { run, isPending: pending } = usePendingTask();
  const { draft, newerElsewhere, edit, saved, reload } = useContentDraft(offer, pending);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(0);
  const { sections } = draft;
  const parsed = parseContentForm(sections);
  const errors = attempted && !parsed.ok ? parsed.errors : {};
  const amounts = liveContentAmounts(sections);
  const newKey = () => {
    setNextKey((key) => key + 1);
    return `new-${nextKey}`;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!parsed.ok) {
      focusFirstInvalidField(parsed.errors);
      return;
    }
    void run(async () => {
      setError(null);
      const since = settle.markChange();
      // Recorded, so this tab skips the Realtime echo of its own save (lib/realtime/own-writes.ts).
      const result = await ownWrites
        .track(
          saveOfferContent({
            offerId: offer.id,
            expectedContentVersion: draft.baseVersion,
            attemptKey: draft.attemptKey,
            sections: parsed.sections,
          }),
        )
        .catch(() => null);
      if (!result?.success) {
        setError(result ? describeFailure(result.error, CONTENT_FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED);
        // The newer content may not have reached this tab yet; its render offers „Neu laden“.
        if (result?.error === 'offer_changed') router.refresh();
        return;
      }
      saved();
      setAttempted(false);
      // A retry after a lost answer can name the version the page already shows.
      const confirmed = result.contentVersion === offer.contentVersion || (await settle.confirmChange(since));
      if (confirmed) showBanner({ variant: 'success', message: 'Positionen gespeichert.' });
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-labelledby="offer-content-title">
      <SectionTitle as="h3" id="offer-content-title">
        Titel und Positionen
      </SectionTitle>
      {newerElsewhere && (
        <StaleContentNotice
          onReload={() => {
            reload();
            setError(null);
          }}
        />
      )}
      <OfferSectionList
        sections={sections}
        amounts={amounts}
        onChange={edit}
        newKey={newKey}
        errors={errors}
        disabled={pending}
      />
      <InvoiceTotals amounts={amounts} />
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        <ErrorText>{error}</ErrorText>
        <Button type="submit" pending={pending}>
          <Save className="size-4" />
          Speichern
        </Button>
      </div>
    </form>
  );
}

function StaleContentNotice({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      <p className="min-w-0 flex-1">
        Jemand hat die Positionen inzwischen geändert. Lade sie neu, deine Eingaben gehen dabei verloren.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        Neu laden
      </Button>
    </div>
  );
}

/** The Titel in order, or the first step while there is none, and adding a Titel. */
function OfferSectionList({
  sections,
  amounts,
  onChange,
  newKey,
  errors,
  disabled,
}: {
  sections: SectionForm[];
  amounts: OfferAmounts | null;
  onChange: (sections: SectionForm[]) => void;
  newKey: () => string;
  errors: Record<string, string | undefined>;
  disabled: boolean;
}) {
  return (
    <>
      {sections.length === 0 ? (
        <EmptyState
          size="compact"
          title="Noch keine Positionen."
          description="Lege den ersten Titel an, zum Beispiel „Heizung“, und füge ihm Positionen hinzu."
        />
      ) : (
        <ol className="space-y-4">
          {sections.map((section, index) => (
            <OfferSectionFields
              key={section.key}
              index={index}
              count={sections.length}
              section={section}
              amounts={amounts?.sections[index] ?? null}
              onChange={(next) => onChange(sections.map((current, at) => (at === index ? next : current)))}
              onMove={(direction) => onChange(move(sections, index, direction))}
              onRemove={() => onChange(sections.filter((_section, at) => at !== index))}
              newKey={newKey}
              errors={errors}
              disabled={disabled}
            />
          ))}
        </ol>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...sections, { key: newKey(), title: '', positions: [] }])}
        disabled={disabled}
      >
        <Plus className="size-4" />
        Titel hinzufügen
      </Button>
    </>
  );
}
