import { AlertTriangle, CircleCheck } from 'lucide-react';

import { AiInlineText } from '@/components/shared/ai-markdown';
import { Badge } from '@/components/ui/badge';
import type { LieferscheinCard } from '@/lib/ui/ki-lieferschein';

/**
 * A read Lieferschein as a „KI-Entwurf“ (B20 of werk-flow/werkflow-planning#20):
 * the validated fields the tool returned, each line with its own article or a
 * marked problem. Every text came from the document or a record and renders
 * through the safe renderer (B11). Nothing on it books anything.
 */
export function KiLieferscheinCard({ card }: { card: LieferscheinCard }): React.JSX.Element {
  return (
    <section aria-label={card.title} className="space-y-3 rounded-lg border bg-card p-3 text-foreground">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            <AiInlineText text={card.title} links={false} />
          </p>
          {card.facts && (
            <p className="text-xs text-muted-foreground">
              <AiInlineText text={card.facts} links={false} />
            </p>
          )}
        </div>
        <Badge variant="warning">KI-Entwurf</Badge>
      </header>
      {card.lines.length === 0 ? (
        <p className="text-muted-foreground">Keine Positionen gelesen.</p>
      ) : (
        <ol className="space-y-2">
          {card.lines.map((line) => {
            const marked = line.problems.length > 0 || (card.matched && line.match === null);
            return (
              <li key={line.nr} className="flex gap-2">
                {marked ? (
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-text" />
                ) : (
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-text" />
                )}
                <div className="min-w-0 space-y-0.5">
                  <p className="break-words">
                    <AiInlineText text={line.delivered} links={false} />
                  </p>
                  {line.match && (
                    <p className="break-words text-xs text-muted-foreground">
                      → <AiInlineText text={line.match} links={false} />
                    </p>
                  )}
                  {line.problems.map((problem) => (
                    <p key={problem} className="text-xs text-warning-text">
                      {problem}
                    </p>
                  ))}
                  <span className="sr-only">{marked ? ', prüfen' : ', passt'}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {card.left === null ? (
        <p className="text-xs text-muted-foreground">
          Ob der Lieferschein weitere Positionen hat, ist unklar.
        </p>
      ) : (
        card.left > 0 && (
          <p className="text-xs text-muted-foreground">
            {card.left} weitere {card.left === 1 ? 'Position fehlt' : 'Positionen fehlen'} in dieser Liste.
          </p>
        )
      )}
      {!card.matched && (
        <p className="text-xs text-muted-foreground">Die Artikel konnten nicht abgeglichen werden.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Nichts ist gebucht. Prüf jede Position am Lieferschein, bevor du sie übernimmst.
      </p>
    </section>
  );
}
