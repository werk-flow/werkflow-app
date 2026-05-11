'use client';

import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type AttendanceBlockSegmentVisual = {
  id: string;
  left: number;
  width: number;
  type: 'work' | 'break';
};

interface AttendanceBlockProps {
  left: number;
  width: number;
  title: string;
  primaryText: string;
  secondaryText: string;
  segments: AttendanceBlockSegmentVisual[];
  isActive?: boolean;
  layoutTop?: number;
  layoutHeight?: number;
}

export function AttendanceBlock({
  left,
  width,
  title,
  primaryText,
  secondaryText,
  segments,
  isActive = false,
  layoutTop,
  layoutHeight
}: AttendanceBlockProps) {
  const hasLayout = layoutTop !== undefined && layoutHeight !== undefined;
  const compact = hasLayout && layoutHeight <= 28;

  return (
    <div
      className={cn(
        'absolute overflow-hidden rounded-md text-xs font-medium text-white shadow-sm transition-shadow z-10',
        !hasLayout && 'top-1 h-14',
        isActive && 'animate-pulse',
        'hover:shadow-md'
      )}
      style={{
        left,
        width,
        ...(hasLayout ? { top: layoutTop, height: layoutHeight } : {})
      }}
      title={title}
    >
      <div className="absolute inset-0">
        {segments.map((segment) => (
          <div
            key={segment.id}
            className={cn(
              'absolute inset-y-0',
              segment.type === 'break'
                ? 'bg-yellow-500/85'
                : 'bg-green-500/75 dark:bg-green-600/75'
            )}
            style={{ left: segment.left, width: segment.width }}
          />
        ))}
      </div>

      <div className="absolute inset-0 bg-black/5" />

      <div
        className={cn(
          'relative flex h-full items-center justify-center px-2',
          !compact && 'flex-col'
        )}
      >
        {width > 80 ? (
          compact ? (
            <div className="flex items-center gap-1 truncate drop-shadow-sm">
              <Clock className="h-2.5 w-2.5 shrink-0 opacity-80" />
              <span className="truncate text-[10px]">{primaryText}</span>
              <span className="text-[9px] opacity-70">•</span>
              <span className="truncate text-[10px] opacity-80">{secondaryText}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 truncate drop-shadow-sm">
                <Clock className="h-3 w-3 shrink-0 opacity-80" />
                <span className="truncate">{primaryText}</span>
              </div>
              <span className="truncate text-[10px] opacity-80 drop-shadow-sm">
                {secondaryText}
              </span>
            </>
          )
        ) : width > 40 ? (
          <div className="flex items-center gap-1 truncate drop-shadow-sm">
            <Clock className={cn('shrink-0 opacity-80', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
            <span className="truncate">{secondaryText}</span>
          </div>
        ) : (
          <Clock className={cn('shrink-0 opacity-80 drop-shadow-sm', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
        )}
      </div>
    </div>
  );
}
