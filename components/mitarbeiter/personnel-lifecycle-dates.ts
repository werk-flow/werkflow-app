export function formatLifecycleDate(value: string | null): string {
  if (!value) return 'Nicht festgelegt';
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}

function berlinIsoDateAtOffset(offsetDays: number): string {
  const berlinDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const value = new Date(`${berlinDate}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

export function todayDate(): Date {
  return new Date(`${berlinIsoDateAtOffset(0)}T12:00:00`);
}

export function defaultAccessDateTime(): string {
  return `${berlinIsoDateAtOffset(1)}T09:00`;
}
