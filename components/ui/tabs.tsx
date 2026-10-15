'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';
import { useHydrated } from '@/hooks/use-hydrated';
import { scrollRegion } from '@/components/ui/scroll-region';
import { inlineScrollDelta } from '@/lib/ui/tab-strip-scroll';

/** False when the tab set switches a view or a filter without `TabsContent` panels. */
const TabsPanelsContext = React.createContext(true);

/**
 * `panels={false}` marks a tab set that filters a list or switches a view
 * without `TabsContent` panels (Anfragen status, the calendar views): its tabs
 * then point at no panel, instead of at panel ids that never exist (axe
 * `aria-valid-attr-value`). `lib/ui/tabs-panels.test.ts` requires the prop on
 * every tab set that renders no panel.
 */
function Tabs({
  className,
  panels = true,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { panels?: boolean }) {
  return (
    <TabsPanelsContext.Provider value={panels}>
      <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-2', className)} {...props} />
    </TabsPanelsContext.Provider>
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      {...scrollRegion('tab-strip')}
      className={cn(
        // max-w-full + overflow-x-auto: a strip with many tabs scrolls within itself on
        // phones instead of widening the page (design canon: no page-level
        // horizontal scroll). justify-start keeps the first tab reachable.
        'bg-muted/60 inline-flex h-9 w-fit max-w-full shrink-0 items-center justify-start overflow-x-auto rounded-md p-0.5 gap-0.5 [scrollbar-width:none]',
        className,
      )}
      {...props}
    />
  );
}

/** Scrolls the trigger's strip sideways until the trigger is visible; the page does not move. */
function revealInStrip(trigger: HTMLElement): void {
  if (trigger.dataset.state !== 'active') return;
  const strip = trigger.closest<HTMLElement>('[data-slot="tabs-list"]');
  if (!strip) return;
  strip.scrollLeft += inlineScrollDelta(strip.getBoundingClientRect(), trigger.getBoundingClientRect());
}

/**
 * A tab strip keeps its active tab in view: when a trigger is active on mount,
 * becomes active later (a click, a key, a URL) or its strip narrows (a
 * rotated phone, a narrower window), its strip scrolls to it.
 */
function keepActiveTriggerInView(trigger: HTMLButtonElement | null): (() => void) | undefined {
  if (!trigger) return undefined;
  revealInStrip(trigger);
  const observer = new MutationObserver(() => revealInStrip(trigger));
  observer.observe(trigger, { attributes: true, attributeFilter: ['data-state'] });
  const strip = trigger.closest<HTMLElement>('[data-slot="tabs-list"]');
  const resizeObserver = new ResizeObserver(() => revealInStrip(trigger));
  if (strip) resizeObserver.observe(strip);
  return () => {
    observer.disconnect();
    resizeObserver.disconnect();
  };
}

function TabsTrigger({
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof TabsPrimitive.Trigger>, 'ref'>) {
  const hydrated = useHydrated();
  const panels = React.useContext(TabsPanelsContext);
  return (
    <TabsPrimitive.Trigger
      ref={keepActiveTriggerInView}
      data-slot="tabs-trigger"
      // The tab's stable value names it for the rendered audit's tab inventory.
      data-value={props.value}
      disabled={disabled || !hydrated}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
        'text-muted-foreground hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:bg-background data-[state=active]:text-foreground',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        className,
      )}
      {...props}
      {...(panels ? {} : { 'aria-controls': undefined })}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
