'use client';

import { useEffect, useState } from 'react';

// Base timeline configuration
export const BASE_HOUR_WIDTH = 60;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const HOUR_WIDTH = BASE_HOUR_WIDTH;
export const TIMELINE_WIDTH = HOURS.length * HOUR_WIDTH;

export function getEffectiveHourWidth(zoom: number) {
  return BASE_HOUR_WIDTH * zoom;
}

export function getTimelineWidth(zoom: number) {
  return 24 * getEffectiveHourWidth(zoom);
}

/**
 * Calculate the position and width for a time block.
 * When `hourWidth` is provided, returns pixel positions using that scale.
 */
export function calculateBlockPosition(
  startTime: Date,
  endTime: Date | null,
  hourWidth: number = HOUR_WIDTH
): { left: number; width: number } {
  const startHours = startTime.getHours() + startTime.getMinutes() / 60;
  const left = startHours * hourWidth;

  if (!endTime) {
    const now = new Date();
    const isToday = startTime.toDateString() === now.toDateString();
    const endHours = isToday ? now.getHours() + now.getMinutes() / 60 : 24;
    const width = Math.max((endHours - startHours) * hourWidth, 10);
    return { left, width };
  }

  const endHours = endTime.getHours() + endTime.getMinutes() / 60;
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

interface TimelineGridProps {
  showHeader?: boolean;
  children?: React.ReactNode;
}

export function TimelineGrid({
  showHeader = false,
  children
}: TimelineGridProps) {
  const [currentTimePosition, setCurrentTimePosition] = useState<number | null>(
    null
  );

  useEffect(() => {
    const updateCurrentTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const position = (hours + minutes / 60) * HOUR_WIDTH;
      setCurrentTimePosition(position);
    };

    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
    return () => clearInterval(interval);
  }, []);

  if (showHeader) {
    return (
      <div className="relative h-8" style={{ minWidth: TIMELINE_WIDTH }}>
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="absolute top-0 h-full border-l border-border"
            style={{ left: hour * HOUR_WIDTH }}
          >
            <span className="absolute -top-0.5 -left-3 text-xs text-muted-foreground">
              {hour.toString().padStart(2, '0')}
            </span>
          </div>
        ))}
        <div
          className="absolute top-0 h-full border-l border-border"
          style={{ left: 24 * HOUR_WIDTH }}
        />
      </div>
    );
  }

  return (
    <div className="relative h-16" style={{ minWidth: TIMELINE_WIDTH }}>
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute top-0 h-full border-l border-border/50"
          style={{ left: hour * HOUR_WIDTH }}
        />
      ))}

      {currentTimePosition !== null && (
        <div
          className="absolute top-0 h-full w-0.5 bg-destructive z-10"
          style={{ left: currentTimePosition }}
        >
          <div className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-destructive" />
        </div>
      )}

      {children}
    </div>
  );
}
