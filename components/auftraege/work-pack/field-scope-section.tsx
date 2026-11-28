import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';
import { formatQuantity } from '@/lib/document-rendering/format';
import type { FieldScopeOrder } from '@/lib/orders/types';

/**
 * „Auftragsumfang“ for the field worker and the project lead: what the
 * customer ordered, as text, quantity and unit, never a price. Work without
 * an order shows nothing.
 */
export function FieldScopeSection({ scope }: { scope: FieldScopeOrder[] | 'failed' }) {
  if (scope === 'failed') {
    return (
      <RegionLoadError title="Der Auftragsumfang konnte nicht geladen werden">
        Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  if (scope.length === 0) return null;
  return (
    <section aria-labelledby="field-scope-title" className="space-y-3">
      <SectionTitle id="field-scope-title">Auftragsumfang</SectionTitle>
      {scope.map((order) => (
        <div
          key={`${order.workKind}-${order.offerNumber}`}
          className="space-y-3 rounded-lg border bg-card p-4 text-sm shadow-xs"
        >
          {order.workKind === 'project' && (
            <p className="text-muted-foreground">Umfang des ganzen Projekts</p>
          )}
          {order.sections.map((section) => (
            <div key={section.number} className="space-y-1">
              <p className="font-medium wrap-anywhere">{`${section.number}. ${section.title}`}</p>
              <ul className="divide-y">
                {section.lines.map((line, index) => (
                  <li
                    key={line.kind === 'position' ? line.number : `text-${index}`}
                    className="flex justify-between gap-4 py-1.5"
                  >
                    <span className="min-w-0 wrap-anywhere">
                      {line.kind === 'position' ? `${line.number} ${line.name}` : line.name}
                      {line.description && (
                        <span className="block whitespace-pre-line text-muted-foreground">
                          {line.description}
                        </span>
                      )}
                    </span>
                    {line.kind === 'position' && (
                      <span className="shrink-0 tabular-nums">{`${formatQuantity(line.quantity)} ${line.unitLabel}`}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
