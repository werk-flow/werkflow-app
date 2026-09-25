'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { autoScrollVelocity, exceedsDragThreshold } from '@/lib/calendar/drag-math';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { targetKey, type CalendarDragPayload, type CalendarDragTarget, type DragModifiers, type DragVerdict } from './payload';

/**
 * The calendar's one drag engine (P1-24a, decision Q6): pointer events with
 * capture, a five-pixel threshold, a ghost moved by `transform` inside one
 * animation frame per pointer batch, hit testing against the active
 * surface's precomputed map, auto-scroll near the edges, Escape to cancel,
 * and no React state between the start and the drop. The active view
 * registers a surface; side panels register drop zones; every draggable
 * calls `startDrag` from its pointer-down handler.
 */

export type DragSurface = {
  /** Client coordinates to a target, against a map computed at drag start. */
  /** `origin` is the ghost's top-left corner: the card's own edge, for surfaces with an axis. */
  resolveTarget: (point: { x: number; y: number }, payload: CalendarDragPayload, modifiers: DragModifiers, origin: { x: number; y: number }) => CalendarDragTarget | null;
  /** The client pre-check: the same rule the server enforces, or a view rule. */
  checkTarget: (target: CalendarDragTarget, payload: CalendarDragPayload, modifiers: DragModifiers) => DragVerdict;
  /** Called on target change only; writes to the DOM, never to React state. */
  onTargetChange?: (target: CalendarDragTarget | null, verdict: DragVerdict | null, payload: CalendarDragPayload) => void;
  onDrop: (target: CalendarDragTarget, payload: CalendarDragPayload, modifiers: DragModifiers) => void;
  onEnd?: (payload: CalendarDragPayload) => void;
  /** Auto-scroll container, if any. */
  scrollContainer: () => HTMLElement | null;
  /** Called once at drag start so the surface can compute its map. */
  prepare?: (payload: CalendarDragPayload) => void;
};

export type DragSession = {
  payload: CalendarDragPayload;
  ghost: { label: string; secondary?: string | undefined; width: number; height: number };
  /** Pointer offset from the card's top-left corner. */
  pointerOffset: { x: number; y: number };
};

type ZoneRegistration = { zone: 'parkplatz'; element: HTMLElement };

type EngineContextValue = {
  startDrag: (event: React.PointerEvent, session: DragSession) => void;
  registerSurface: (surface: DragSurface | null) => void;
  registerDropZone: (registration: ZoneRegistration) => () => void;
  /** True while a drag is in progress; a ref so reading it never renders. */
  isDragging: () => boolean;
  /** Read-only mode refuses every start; the surface shows the reason. */
  setLocked: (locked: boolean, message: string) => void;
};

const DragEngineContext = createContext<EngineContextValue | null>(null);

type ActiveDrag = {
  session: DragSession;
  pointerId: number;
  start: { x: number; y: number };
  last: { x: number; y: number; alt: boolean; shift: boolean };
  moved: boolean;
  zones: Array<{ zone: 'parkplatz'; rect: DOMRect }>;
  targetKey: string;
  target: CalendarDragTarget | null;
  verdict: DragVerdict | null;
  frame: number | null;
  captured: Element | null;
  /** When the pointer entered the container's auto-scroll edge; a pointer crossing the edge does not scroll. */
  edgeSince: number | null;
};

const LONG_PRESS_MS = 250;
const AUTO_SCROLL_DWELL_MS = 150;

export function CalendarDragProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const ghostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<DragSurface | null>(null);
  const zonesRef = useRef<ZoneRegistration[]>([]);
  const activeRef = useRef<ActiveDrag | null>(null);
  const lockRef = useRef<{ locked: boolean; message: string }>({ locked: false, message: '' });
  const lockNoticeRef = useRef<HTMLDivElement>(null);

  const paintGhost = useCallback((drag: ActiveDrag) => {
    const ghost = ghostRef.current;
    if (!ghost) return;
    const x = drag.last.x - drag.session.pointerOffset.x;
    const y = drag.last.y - drag.session.pointerOffset.y;
    ghost.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    const verdict = drag.verdict;
    ghost.dataset.state = !drag.target ? 'idle' : verdict?.ok ? 'valid' : 'refused';
    const message = ghost.querySelector<HTMLElement>('[data-ghost-message]');
    if (message) {
      const text = drag.target && verdict && !verdict.ok ? verdict.message : (verdict?.ok && verdict.label) || '';
      if (message.textContent !== text) message.textContent = text;
      message.hidden = text === '';
    }
  }, []);

  // The click that follows a pointer release lands on the drag source; after a
  // moved drag it must not open the card. One capture-phase listener eats it
  // and leaves on the next task if no click arrives.
  const suppressNextClick = useCallback(() => {
    const swallow = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); remove(); };
    const remove = () => { window.removeEventListener('click', swallow, true); window.clearTimeout(timer); };
    window.addEventListener('click', swallow, true);
    const timer = window.setTimeout(remove, 0);
  }, []);

  const finish = useCallback((dropped: boolean) => {
    const drag = activeRef.current;
    if (!drag) return;
    activeRef.current = null;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    document.body.classList.remove('is-dragging');
    const ghost = ghostRef.current;
    if (ghost) { ghost.hidden = true; ghost.dataset.state = 'idle'; }
    if (drag.captured && 'releasePointerCapture' in drag.captured) {
      try { (drag.captured as HTMLElement).releasePointerCapture(drag.pointerId); } catch { /* already released */ }
    }
    if (drag.moved) suppressNextClick();
    const surface = surfaceRef.current;
    surface?.onTargetChange?.(null, null, drag.session.payload);
    if (dropped && drag.moved && drag.target && drag.verdict?.ok && surface) {
      surface.onDrop(drag.target, drag.session.payload, { copy: drag.last.alt, fine: drag.last.shift });
    }
    surface?.onEnd?.(drag.session.payload);
  }, [suppressNextClick]);

  // One frame per pointer batch: resolve the target, run the pre-check on a
  // change, auto-scroll the surface's container, and paint the ghost.
  const stepRef = useRef<() => void>(() => undefined);
  const step = useCallback(() => {
    const drag = activeRef.current;
    if (!drag) return;
    drag.frame = null;
    const surface = surfaceRef.current;
    const point = { x: drag.last.x, y: drag.last.y };
    const container = surface?.scrollContainer() ?? null;
    if (container) {
      const rect = container.getBoundingClientRect();
      const dx = autoScrollVelocity(point.x, rect.left, rect.right);
      const dy = autoScrollVelocity(point.y, rect.top, rect.bottom);
      if (dx !== 0 || dy !== 0) {
        // The pointer stays in the edge zone for a moment before the container scrolls, so a card
        // carried across the edge from a side panel lands where the planner sees it.
        drag.edgeSince ??= performance.now();
        if (performance.now() - drag.edgeSince >= AUTO_SCROLL_DWELL_MS) container.scrollBy(dx, dy);
        drag.frame = requestAnimationFrame(() => stepRef.current());
      } else {
        drag.edgeSince = null;
      }
    }
    const modifiers: DragModifiers = { copy: drag.last.alt, fine: drag.last.shift };
    const origin = { x: point.x - drag.session.pointerOffset.x, y: point.y - drag.session.pointerOffset.y };
    // A card that left the Parkplatz cannot land back on it: the panel's zone is invisible to a parked payload.
    const zone = drag.session.payload.kind === 'parked' ? undefined : drag.zones.find((entry) => point.x >= entry.rect.left && point.x <= entry.rect.right && point.y >= entry.rect.top && point.y <= entry.rect.bottom);
    const target: CalendarDragTarget | null = zone
      ? { kind: 'zone', zone: zone.zone }
      : (surface?.resolveTarget(point, drag.session.payload, modifiers, origin) ?? null);
    const key = targetKey(target);
    if (key !== drag.targetKey) {
      drag.targetKey = key;
      drag.target = target;
      drag.verdict = target && surface ? surface.checkTarget(target, drag.session.payload, modifiers) : null;
      surface?.onTargetChange?.(target, drag.verdict, drag.session.payload);
    }
    paintGhost(drag);
  }, [paintGhost]);
  useEffect(() => { stepRef.current = step; }, [step]);

  const schedule = useCallback(() => {
    const drag = activeRef.current;
    if (!drag || drag.frame !== null) return;
    drag.frame = requestAnimationFrame(step);
  }, [step]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = activeRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const events = 'getCoalescedEvents' in event ? event.getCoalescedEvents() : [];
      const latest = events.length ? events[events.length - 1] ?? event : event;
      drag.last = { x: latest.clientX, y: latest.clientY, alt: event.altKey, shift: event.shiftKey };
      if (!drag.moved) {
        if (!exceedsDragThreshold(drag.start, drag.last)) return;
        drag.moved = true;
        document.body.classList.add('is-dragging');
        const surface = surfaceRef.current;
        surface?.prepare?.(drag.session.payload);
        drag.zones = zonesRef.current.map((registration) => ({ zone: registration.zone, rect: registration.element.getBoundingClientRect() }));
        const ghost = ghostRef.current;
        if (ghost) {
          ghost.hidden = false;
          ghost.style.width = `${drag.session.ghost.width}px`;
          ghost.style.height = `${drag.session.ghost.height}px`;
          const label = ghost.querySelector<HTMLElement>('[data-ghost-label]');
          if (label) label.textContent = drag.session.ghost.label;
          const secondary = ghost.querySelector<HTMLElement>('[data-ghost-secondary]');
          if (secondary) { secondary.textContent = drag.session.ghost.secondary ?? ''; secondary.hidden = !drag.session.ghost.secondary; }
        }
      }
      schedule();
    };
    const onUp = (event: PointerEvent) => {
      const drag = activeRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.last = { x: event.clientX, y: event.clientY, alt: event.altKey, shift: event.shiftKey };
      if (drag.moved) {
        // A final synchronous resolve, so the drop lands where the pointer let go.
        if (drag.frame !== null) { cancelAnimationFrame(drag.frame); drag.frame = null; }
        step();
      }
      finish(true);
    };
    const onCancel = (event: PointerEvent) => {
      const drag = activeRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      finish(false);
    };
    const onKey = (event: KeyboardEvent) => {
      const drag = activeRef.current;
      if (!drag) return;
      if (event.key === 'Escape') { event.preventDefault(); finish(false); return; }
      if (event.key === 'Alt' || event.key === 'Shift') {
        drag.last = { ...drag.last, alt: event.altKey, shift: event.shiftKey };
        drag.targetKey = '';
        schedule();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const drag = activeRef.current;
      if (!drag || (event.key !== 'Alt' && event.key !== 'Shift')) return;
      drag.last = { ...drag.last, alt: event.altKey, shift: event.shiftKey };
      drag.targetKey = '';
      schedule();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      finish(false);
    };
  }, [finish, schedule, step]);

  const startDrag = useCallback((event: React.PointerEvent, session: DragSession) => {
    if (activeRef.current || event.button !== 0) return;
    if (lockRef.current.locked) {
      const notice = lockNoticeRef.current;
      if (notice) {
        notice.textContent = lockRef.current.message;
        notice.hidden = false;
        window.setTimeout(() => { if (notice.textContent === lockRef.current.message) notice.hidden = true; }, 4_000);
      }
      return;
    }
    const element = event.currentTarget;
    const isTouch = event.pointerType === 'touch';
    const drag: ActiveDrag = {
      session,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      last: { x: event.clientX, y: event.clientY, alt: event.altKey, shift: event.shiftKey },
      moved: false,
      zones: [],
      targetKey: 'none',
      target: null,
      verdict: null,
      frame: null,
      captured: element,
      edgeSince: null,
    };
    activeRef.current = drag;
    try { element.setPointerCapture(event.pointerId); } catch { drag.captured = null; }
    if (isTouch) {
      // A touch starts the drag after a long press; a quick swipe pans instead.
      window.setTimeout(() => {
        const current = activeRef.current;
        if (current === drag && !current.moved) {
          current.moved = true;
          document.body.classList.add('is-dragging');
          surfaceRef.current?.prepare?.(session.payload);
          current.zones = zonesRef.current.map((registration) => ({ zone: registration.zone, rect: registration.element.getBoundingClientRect() }));
          const ghost = ghostRef.current;
          if (ghost) { ghost.hidden = false; ghost.style.width = `${session.ghost.width}px`; ghost.style.height = `${session.ghost.height}px`; }
          schedule();
        }
      }, LONG_PRESS_MS);
    }
  }, [schedule]);

  const value = useMemo<EngineContextValue>(() => ({
    startDrag,
    registerSurface: (surface) => { surfaceRef.current = surface; },
    registerDropZone: (registration) => {
      zonesRef.current = [...zonesRef.current, registration];
      return () => { zonesRef.current = zonesRef.current.filter((entry) => entry !== registration); };
    },
    isDragging: () => activeRef.current?.moved === true,
    setLocked: (locked, message) => {
      lockRef.current = { locked, message };
      const notice = lockNoticeRef.current;
      if (notice && !locked) notice.hidden = true;
    },
  }), [startDrag]);

  return (
    <DragEngineContext.Provider value={value}>
      {children}
      <div
        ref={ghostRef}
        hidden
        aria-hidden="true"
        data-calendar-drag-ghost=""
        data-state="idle"
        className={`pointer-events-none fixed left-0 top-0 ${CALENDAR_LAYER_CLASS.drag} flex flex-col justify-center gap-0.5 rounded-md border px-2 py-1 text-xs font-medium shadow-lg will-change-transform data-[state=idle]:border-calendar-planning-border data-[state=idle]:bg-calendar-planning data-[state=idle]:text-calendar-planning-foreground data-[state=valid]:border-calendar-planning-strong data-[state=valid]:bg-calendar-planning data-[state=valid]:text-calendar-planning-foreground data-[state=refused]:border-destructive data-[state=refused]:bg-destructive-soft data-[state=refused]:text-destructive-soft-foreground`}
      >
        <span data-ghost-label="" className="truncate" />
        <span data-ghost-secondary="" className="truncate text-[11px] opacity-80" hidden />
        <span data-ghost-message="" className="whitespace-normal text-[11px] leading-tight" hidden />
      </div>
      <div
        ref={lockNoticeRef}
        hidden
        role="status"
        className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
        onAnimationEnd={() => { if (lockNoticeRef.current) lockNoticeRef.current.hidden = true; }}
      />
    </DragEngineContext.Provider>
  );
}

export function useCalendarDrag(): EngineContextValue {
  const context = useContext(DragEngineContext);
  if (!context) throw new Error('useCalendarDrag requires a CalendarDragProvider.');
  return context;
}

/** Registers the view's surface while it is mounted. */
export function useDragSurface(surface: DragSurface | null): void {
  const { registerSurface } = useCalendarDrag();
  useEffect(() => {
    registerSurface(surface);
    return () => registerSurface(null);
  }, [registerSurface, surface]);
}
