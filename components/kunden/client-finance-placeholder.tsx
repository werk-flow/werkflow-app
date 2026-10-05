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
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Offene Rechnungen
          </p>
          <p className="mt-0.5 text-lg font-semibold text-muted-foreground/50">—</p>
        </div>
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Gesamtumsatz
          </p>
          <p className="mt-0.5 text-lg font-semibold text-muted-foreground/50">—</p>
        </div>
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Bezahlte Rechnungen
          </p>
          <p className="mt-0.5 text-lg font-semibold text-muted-foreground/50">—</p>
        </div>
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Offene Beträge
          </p>
          <p className="mt-0.5 text-lg font-semibold text-muted-foreground/50">—</p>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground/60">
        Finanzübersicht wird verfügbar, sobald Rechnungen und Verträge eingerichtet sind.
      </p>
    </div>
  );
}
