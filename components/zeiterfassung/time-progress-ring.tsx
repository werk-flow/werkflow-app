'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { computeRingSegments, computeRingSegmentsFromTimeline } from '@/lib/time-tracking/helpers';
import type { ClockTimelineSegment } from '@/lib/time-tracking/types';

interface TimeProgressRingProps {
  totalMinutes: number;
  breakMinutes?: number | undefined;
  timelineSegments?: ClockTimelineSegment[] | undefined;
  /** Resolved daily target (P1-04); the overtime ring starts beyond it. */
  targetMinutes?: number | undefined;
  isActive?: boolean | undefined;
  glowVariant?: 'work' | 'break' | undefined;
  size?: number | undefined;
  strokeWidth?: number | undefined;
  children?: React.ReactNode | undefined;
  className?: string | undefined;
}

const SEGMENT_COLORS: Record<string, string> = {
  work: 'var(--status-work)',
  break: 'var(--status-break)',
};
const OVERTIME_COLOR = 'var(--status-overtime)';

// The main ring, and the overtime ring outside it with its gap; the view box fits both.
function ringGeometry(size: number, strokeWidth: number) {
  const center = size / 2;
  const mainRadius = (size - strokeWidth) / 2;
  const mainCircumference = 2 * Math.PI * mainRadius;

  const overtimeGap = 10;
  const overtimeStroke = 6;
  const overtimeRadius = mainRadius + overtimeGap + overtimeStroke / 2;
  const overtimeCircumference = 2 * Math.PI * overtimeRadius;
  const outerSize = (overtimeRadius + overtimeStroke / 2) * 2;

  const viewBox = `${center - outerSize / 2} ${center - outerSize / 2} ${outerSize} ${outerSize}`;
  return {
    center,
    mainRadius,
    mainCircumference,
    overtimeStroke,
    overtimeRadius,
    overtimeCircumference,
    viewBox,
  };
}

type RingGeometry = ReturnType<typeof ringGeometry>;

function OvertimeTrack({ size, geometry }: { size: number; geometry: RingGeometry }) {
  const { viewBox, center, overtimeRadius, overtimeStroke } = geometry;
  return (
    <svg width={size} height={size} viewBox={viewBox} className="absolute inset-0 -rotate-90">
      <circle
        cx={center}
        cy={center}
        r={overtimeRadius}
        fill="none"
        strokeWidth={overtimeStroke}
        className="stroke-muted/40"
      />
    </svg>
  );
}

function RingSegmentArcs({
  segments,
  strokeWidth,
  geometry,
}: {
  segments: ReturnType<typeof computeRingSegments>['segments'];
  strokeWidth: number;
  geometry: RingGeometry;
}) {
  const { center, mainRadius, mainCircumference } = geometry;
  return [...segments].reverse().map((seg, i) => {
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
  });
}

function OvertimeArc({ overtimeFraction, geometry }: { overtimeFraction: number; geometry: RingGeometry }) {
  const { center, overtimeRadius, overtimeStroke, overtimeCircumference } = geometry;
  return (
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
  );
}

export function TimeProgressRing({
  totalMinutes,
  breakMinutes,
  timelineSegments,
  targetMinutes,
  size = 260,
  strokeWidth = 14,
  isActive = false,
  glowVariant = 'work',
  children,
  className,
}: TimeProgressRingProps) {
  const geometry = ringGeometry(size, strokeWidth);
  const { center, mainRadius, viewBox } = geometry;

  const { segments, overtimeFraction } = useMemo(
    () =>
      timelineSegments && timelineSegments.length > 0
        ? computeRingSegmentsFromTimeline(timelineSegments, targetMinutes)
        : computeRingSegments(totalMinutes, breakMinutes, targetMinutes),
    [breakMinutes, targetMinutes, timelineSegments, totalMinutes],
  );

  return (
    <div className={cn('relative inline-flex', className)} style={{ width: size, height: size }}>
      {/* Layer 1 (bottom): overtime empty track – sits BELOW the green glow */}
      {overtimeFraction > 0 && <OvertimeTrack size={size} geometry={geometry} />}

      {/* Layer 2 (middle): main ring + filled arcs + overtime progress – gets the green glow */}
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        className={cn(
          'absolute inset-0 -rotate-90',
          isActive && (glowVariant === 'break' ? 'animate-yellow-glow' : 'animate-green-glow'),
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
        <RingSegmentArcs segments={segments} strokeWidth={strokeWidth} geometry={geometry} />

        {/* Filled overtime arc */}
        {overtimeFraction > 0 && <OvertimeArc overtimeFraction={overtimeFraction} geometry={geometry} />}
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
