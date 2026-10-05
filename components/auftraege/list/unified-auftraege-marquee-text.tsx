'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

import { cn } from '@/lib/utils';

export function MarqueeText({ children, className }: { children: React.ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const check = useCallback(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    const overflow = text.scrollWidth - container.clientWidth;
    if (overflow > 1) {
      setShouldAnimate(true);
      text.style.setProperty('--marquee-distance', `-${overflow}px`);
      const speed = 30;
      text.style.setProperty('--marquee-duration', `${Math.max(4, overflow / speed)}s`);
    } else {
      setShouldAnimate(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(check);
    const observer = new ResizeObserver(check);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [check, children]);

  return (
    // `data-marquee` names the one region that clips its text on purpose (layout audit).
    <div ref={containerRef} data-marquee="" className={cn('overflow-hidden', className)}>
      <span
        ref={textRef}
        // With reduced motion the title does not scroll; it ends in an ellipsis instead of a hard cut.
        className={cn(
          'inline-block whitespace-nowrap motion-reduce:block motion-reduce:truncate',
          shouldAnimate && 'animate-marquee motion-reduce:animate-none',
        )}
      >
        {children}
      </span>
    </div>
  );
}
