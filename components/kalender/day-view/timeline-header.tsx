'use client';

import { useEffect, useState } from 'react';
import { HOUR_WIDTH, TIMELINE_WIDTH } from './timeline-grid';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function TimelineHeader() {
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

  return (
    <div
      className="relative h-10 border-b bg-muted/30"
      style={{ minWidth: TIMELINE_WIDTH }}
    >
      {/* Hour markers */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute top-0 h-full border-l border-border/50"
          style={{ left: hour * HOUR_WIDTH }}
        >
          <span className="absolute top-2 -translate-x-1/2 text-xs font-medium text-muted-foreground">
            {hour.toString().padStart(2, '0')}:00
          </span>
        </div>
      ))}

      {/* Current time indicator */}
      {currentTimePosition !== null && (
        <div
          className="absolute top-0 h-full w-0.5 bg-destructive z-10"
          style={{ left: currentTimePosition }}
        >
          <div className="absolute -top-0.5 -left-1 h-2 w-2 rounded-full bg-destructive" />
        </div>
      )}
    </div>
  );
}
