/** A list row's customer, and the Rechnungsempfänger below it when another party receives the bill. */
export function ClientRecipientLine({
  clientName,
  recipientName,
}: {
  clientName: string;
  recipientName: string | null;
}) {
  return (
    <>
      <p className="truncate">{clientName}</p>
      {recipientName && <p className="truncate text-xs text-muted-foreground">Rechnung an {recipientName}</p>}
    </>
  );
}
