export function parseHoursInputToMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hours = Number.parseFloat(trimmed);
  if (!Number.isFinite(hours) || hours <= 0) return null;

  return Math.round(hours * 60);
}

export function formatMinutesAsHoursInput(
  minutes: number | null | undefined
): string {
  if (!minutes || minutes <= 0) return '';

  const hours = minutes / 60;
  if (Number.isInteger(hours)) return String(hours);

  return String(Number(hours.toFixed(2)));
}

export function calculatePlannedWorkingMinutes(
  estimatedDurationMinutes: number | null | undefined,
  employeeCount: number
): number | null {
  if (!estimatedDurationMinutes || estimatedDurationMinutes <= 0) return null;
  if (employeeCount <= 0) return null;

  return estimatedDurationMinutes * employeeCount;
}
