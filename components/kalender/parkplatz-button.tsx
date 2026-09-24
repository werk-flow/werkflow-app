'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { ParkingSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
export const ParkplatzButton = forwardRef<HTMLButtonElement, ParkplatzButtonProps>(function ParkplatzButton({ count, isOpen, onToggle }, ref) {
  const { registerDropZone } = useCalendarDrag();
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
      variant={isOpen ? 'default' : 'outline'}
      size="default"
      className="relative gap-2"
      onClick={onToggle}
      aria-pressed={isOpen}
      data-parkplatz-zone=""
    >
      <ParkingSquare className="size-4" aria-hidden="true" />
      <span>Parkplatz</span>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-purple px-1 text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </Button>
  );
});
