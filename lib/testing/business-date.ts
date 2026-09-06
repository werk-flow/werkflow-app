const berlinDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function resolveBusinessDate(
  anchor: string | undefined,
  now = new Date(),
): string {
  if (anchor === undefined) return berlinDateFormatter.format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor))
    throw new Error("Invalid test business-date anchor.");
  const parsed = new Date(`${anchor}T12:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== anchor
  ) {
    throw new Error("Invalid test business-date anchor.");
  }
  return anchor;
}

export function testBusinessDate(): string {
  return resolveBusinessDate(process.env.WERKFLOW_TEST_BUSINESS_DATE);
}

export function assertRetainedBusinessDate(recorded: string | undefined, active: string | undefined): void {
  if (!recorded) throw new Error("Retained diagnostics require the run's recorded business date; this legacy run has none.");
  resolveBusinessDate(recorded);
  if (recorded !== active) throw new Error('Retained business date does not match the active diagnostic date. Initialize the run from its retained anchor before restoring state.');
}

export function previousTestBusinessMonth(): { month: string; start: string } {
  const date = new Date(`${testBusinessDate().slice(0, 7)}-15T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const month = date.toISOString().slice(0, 7);
  return { month, start: `${month}-01` };
}
