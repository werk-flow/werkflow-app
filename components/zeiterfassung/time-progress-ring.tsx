'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface TimeProgressRingProps {
  /** Current progress percentage (0-100) */
  percentage: number;
  /** Size of the ring in pixels */
  size?: number;
  /** Stroke width of the ring */
  strokeWidth?: number;
  /** Whether the timer is currently active (pulsing animation) */
  isActive?: boolean;
  /** Children to render in the center */
  children?: React.ReactNode;
  /** Custom class name */
  className?: string;
}

export function TimeProgressRing({
  percentage,
  size = 240,
  strokeWidth = 12,
  isActive = false,
  children,
  className
}: TimeProgressRingProps) {
  const { radius, circumference, strokeDashoffset } = useMemo(() => {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const clampedPercentage = Math.min(Math.max(percentage, 0), 100);
    const offset = c - (clampedPercentage / 100) * c;

    return {
      radius: r,
      circumference: c,
      strokeDashoffset: offset
    };
  }, [size, strokeWidth, percentage]);

  const center = size / 2;

  // Determine color based on progress
  const getProgressColor = () => {
    if (percentage >= 100) return 'stroke-green-500';
    if (percentage >= 75) return 'stroke-green-500';
    return 'stroke-brand-purple';
  };

  return (
    <div className={cn('relative inline-flex', className)}>
      <svg
        width={size}
        height={size}
        className={cn(
          'transform -rotate-90',
          isActive && 'drop-shadow-[0_0_15px_rgba(123,44,191,0.3)]'
        )}
      >
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />

        {/* Progress circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={cn(
            'transition-all duration-500 ease-out',
            getProgressColor(),
            isActive && 'animate-pulse'
          )}
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
