'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  computeRingSegments,
  computeRingSegmentsFromTimeline
} from '@/lib/time-tracking/helpers';
import type { ClockTimelineSegment } from '@/lib/time-tracking/types';

interface TimeProgressRingProps {
  totalMinutes: number;
  breakMinutes?: number;
  timelineSegments?: ClockTimelineSegment[];
  isActive?: boolean;
  glowVariant?: 'work' | 'break';
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
  className?: string;
}

const SEGMENT_COLORS: Record<string, string> = {
  work: '#22c55e',   // green-500
  break: '#eab308',  // yellow-500
};
const OVERTIME_COLOR = '#3b82f6'; // blue-500

export function TimeProgressRing({
  totalMinutes,
  breakMinutes,
  timelineSegments,
  size = 260,
  strokeWidth = 14,
  isActive = false,
  glowVariant = 'work',
  children,
  className
}: TimeProgressRingProps) {
  const center = size / 2;
  const mainRadius = (size - strokeWidth) / 2;
  const mainCircumference = 2 * Math.PI * mainRadius;

  const overtimeGap = 10;
  const overtimeStroke = 6;
  const overtimeRadius = mainRadius + overtimeGap + overtimeStroke / 2;
  const overtimeCircumference = 2 * Math.PI * overtimeRadius;
  const outerSize = (overtimeRadius + overtimeStroke / 2) * 2;

  const { segments, overtimeFraction } = useMemo(
    () =>
      timelineSegments && timelineSegments.length > 0
        ? computeRingSegmentsFromTimeline(timelineSegments)
        : computeRingSegments(totalMinutes, breakMinutes),
    [breakMinutes, timelineSegments, totalMinutes]
  );

  const viewBox = `${center - outerSize / 2} ${center - outerSize / 2} ${outerSize} ${outerSize}`;

  return (
    <div className={cn('relative inline-flex', className)} style={{ width: size, height: size }}>
      {/* Layer 1 (bottom): overtime empty track – sits BELOW the green glow */}
      {overtimeFraction > 0 && (
        <svg
          width={size}
          height={size}
          viewBox={viewBox}
          className="absolute inset-0 -rotate-90"
        >
          <circle
            cx={center}
            cy={center}
            r={overtimeRadius}
            fill="none"
            strokeWidth={overtimeStroke}
            className="stroke-muted/40"
          />
        </svg>
      )}

      {/* Layer 2 (middle): main ring + filled arcs + overtime progress – gets the green glow */}
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        className={cn(
          'absolute inset-0 -rotate-90',
          isActive &&
            (glowVariant === 'break'
              ? 'animate-yellow-glow'
              : 'animate-green-glow')
        )}
      >
        {/* Main ring background */}
        <circle
          cx={center}
          cy={center}
          r={mainRadius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />

        {/* Main ring segments – reversed so green paints on top of yellow */}
        {[...segments].reverse().map((seg, i) => {
          const arcLength = (seg.endFraction - seg.startFraction) * mainCircumference;
          const offset = seg.startFraction * mainCircumference;
          return (
            <circle
              key={i}
              cx={center}
              cy={center}
              r={mainRadius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              stroke={SEGMENT_COLORS[seg.type]}
              strokeDasharray={`${arcLength} ${mainCircumference - arcLength}`}
              strokeDashoffset={-offset}
              className="transition-all duration-500 ease-out"
            />
          );
        })}

        {/* Filled overtime arc */}
        {overtimeFraction > 0 && (
          <circle
            cx={center}
            cy={center}
            r={overtimeRadius}
            fill="none"
            strokeWidth={overtimeStroke}
            strokeLinecap="round"
            stroke={OVERTIME_COLOR}
            strokeDasharray={`${overtimeFraction * overtimeCircumference} ${overtimeCircumference - overtimeFraction * overtimeCircumference}`}
            strokeDashoffset={0}
            className="transition-all duration-500 ease-out"
          />
        )}
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
