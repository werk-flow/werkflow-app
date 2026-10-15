import { Receipt } from 'lucide-react';
import { SectionTitle } from '@/components/shared/section-title';

/** Placeholder until invoices and contracts exist; every figure shows a dash. */
export function ClientFinancePlaceholder() {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <SectionTitle icon={<Receipt className="size-4" />} className="mb-3">
        Finanzen
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Offene Rechnungen
          </p>
          <p className="mt-0.5 text-lg font-semibold text-muted-foreground">—</p>
        </div>
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Gesamtumsatz
          </p>
          <p className="mt-0.5 text-lg font-semibold text-muted-foreground">—</p>
        </div>
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Bezahlte Rechnungen
          </p>
          <p className="mt-0.5 text-lg font-semibold text-muted-foreground">—</p>
        </div>
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Offene Beträge
          </p>
          <p className="mt-0.5 text-lg font-semibold text-muted-foreground">—</p>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Finanzübersicht wird verfügbar, sobald Rechnungen und Verträge eingerichtet sind.
      </p>
    </div>
  );
}
