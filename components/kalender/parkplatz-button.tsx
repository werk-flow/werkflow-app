'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { ParkingSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';
import { useCalendarDrag } from './drag-engine/drag-engine';

interface ParkplatzButtonProps {
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * The header's Parkplatz toggle is also a drop zone of the shared engine
 * (P1-24a): dragging any card over it parks the job, whether or not the
 * panel is open. The engine highlights the ghost; the button itself stays
 * quiet so the header never flashes.
 */
export const ParkplatzButton = forwardRef<HTMLButtonElement, ParkplatzButtonProps>(function ParkplatzButton(
  { count, isOpen, onToggle },
  ref,
) {
  const { registerDropZone } = useCalendarDrag();
  const hydrated = useHydrated();
  const buttonRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => buttonRef.current as HTMLButtonElement);
  useEffect(() => {
    const element = buttonRef.current;
    if (!element) return;
    return registerDropZone({ zone: 'parkplatz', element });
  }, [registerDropZone]);

  return (
    <Button
      ref={buttonRef}
      variant={isOpen ? 'secondary' : 'ghost'}
      size="default"
      className="relative h-11 gap-2 sm:h-9"
      onClick={onToggle}
      disabled={!hydrated}
      aria-label={
        count > 0
          ? `Parkplatz, ${count} ${count === 1 ? 'geparkter Auftrag' : 'geparkte Aufträge'}`
          : 'Parkplatz'
      }
      aria-pressed={isOpen}
      data-parkplatz-zone=""
    >
      <ParkingSquare className="size-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">Parkplatz</span>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-purple px-1 text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </Button>
  );
});
