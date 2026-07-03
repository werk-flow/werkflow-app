'use client';

import { useState, forwardRef } from 'react';
import { ParkingSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearCalendarDragState } from './drag-state';
import { cn } from '@/lib/utils';

const MIME_TYPE = 'application/x-werkflow-job';

interface ParkplatzButtonProps {
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  onParkJob: (jobId: string) => void;
  isPointerOverParkplatz?: boolean;
}

export const ParkplatzButton = forwardRef<HTMLButtonElement, ParkplatzButtonProps>(
  function ParkplatzButton({ count, isOpen, onToggle, onParkJob, isPointerOverParkplatz }, ref) {
    const [isDragOver, setIsDragOver] = useState(false);

    const showHighlight = isDragOver || isPointerOverParkplatz;

    return (
      <Button
        ref={ref}
        variant={isOpen ? 'default' : 'outline'}
        size="default"
        className={cn(
          'gap-2 relative transition-all',
          showHighlight && 'ring-2 ring-brand-purple/60 bg-brand-purple/10 scale-105'
        )}
        onClick={onToggle}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(MIME_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setIsDragOver(true);
          }
        }}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes(MIME_TYPE)) {
            e.preventDefault();
            setIsDragOver(true);
          }
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          clearCalendarDragState();
          const raw = e.dataTransfer.getData(MIME_TYPE);
          if (!raw) return;
          try {
            const { jobId } = JSON.parse(raw);
            if (jobId) onParkJob(jobId);
          } catch { /* ignore parse errors */ }
        }}
      >
        <ParkingSquare className="size-4" />
        <span>Parkplatz</span>
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-purple text-[10px] font-bold text-white px-1">
            {count}
          </span>
        )}
      </Button>
    );
  }
);
