'use client';

// Base timeline configuration
export const BASE_HOUR_WIDTH = 60;

export function getVisibleGridIntervalMinutes(hourWidth: number): 15 | 30 | 60 {
  if (hourWidth >= 200) return 15;
  if (hourWidth >= 120) return 30;
  return 60;
}

export function getVisibleGridSubdivisions(hourWidth: number): number[] {
  const intervalMinutes = getVisibleGridIntervalMinutes(hourWidth);
  if (intervalMinutes === 15) return [15, 30, 45];
  if (intervalMinutes === 30) return [30];
  return [];
}

/**
 * Calculate the position and width for a time block.
 * When `hourWidth` is provided, returns pixel positions using that scale.
 */
export function calculateBlockPosition(
  startTime: Date,
  endTime: Date | null,
  hourWidth: number = BASE_HOUR_WIDTH
): { left: number; width: number } {
  const startHours =
    startTime.getHours() +
    startTime.getMinutes() / 60 +
    startTime.getSeconds() / 3600 +
    startTime.getMilliseconds() / 3600000;
  const left = startHours * hourWidth;

  if (!endTime) {
    const now = new Date();
    const isToday = startTime.toDateString() === now.toDateString();
    const endHours = isToday
      ? now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
      : 24;
    const width = Math.max((endHours - startHours) * hourWidth, 10);
    return { left, width };
  }

  const endHours =
    endTime.getHours() +
    endTime.getMinutes() / 60 +
    endTime.getSeconds() / 3600 +
    endTime.getMilliseconds() / 3600000;
  const width = Math.max((endHours - startHours) * hourWidth, 10);

  return { left, width };
}

export function snapToGrid(px: number, hourWidth: number): number {
  const snapMinutes = hourWidth >= 200 ? 15 : 30;
  const snapPx = (snapMinutes / 60) * hourWidth;
  return Math.round(px / snapPx) * snapPx;
}

export function pixelToTimeStr(px: number, hourWidth: number, baseDate: Date): string {
  const totalMinutes = Math.max(0, Math.min(24 * 60, Math.round((px / hourWidth) * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const d = new Date(baseDate);
  d.setHours(Math.min(23, hours), Math.min(59, minutes), 0, 0);
  return d.toISOString();
}

export function formatTimeFromPx(px: number, hourWidth: number): string {
  const totalMinutes = Math.max(0, Math.min(24 * 60, Math.round((px / hourWidth) * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}
