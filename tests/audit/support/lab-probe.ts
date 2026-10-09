import type { Page } from '@playwright/test';

// In-page counters of a lab step (docs/technical/performance.md). Installed
// before the first document of the page, so React finds the DevTools hook
// when it loads: a production React DOM build calls `inject` once and
// `onCommitFiberRoot` on every commit. On each commit the probe counts the
// components that rendered, the way React DevTools decides it: a mounted
// component, or one whose fiber carries the PerformedWork flag, inside a
// subtree whose child pointer changed (an untouched subtree is skipped). One
// mutation observer covers the whole
// document, and two performance observers count main-thread tasks and
// animation frames over 50 ms. The counters hold numbers only, never content.

export type LabProbeCounts = {
  reactCommits: number;
  componentRenders: number;
  reactRenderers: number;
  domMutations: number;
  longTasks: number;
  longTaskMs: number;
  longAnimationFrames: number;
};

declare global {
  interface Window {
    __werkflowLab?: { reset: () => void; read: () => LabProbeCounts };
  }
}

function probeScript(): void {
  const counts = {
    reactCommits: 0,
    componentRenders: 0,
    reactRenderers: 0,
    domMutations: 0,
    longTasks: 0,
    longTaskMs: 0,
    longAnimationFrames: 0,
  };
  const renderers = new Map<number, unknown>();
  // Function, class, forwardRef, memo and simple memo components (React's fiber tags).
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const PERFORMED_WORK = 1;
  type LabFiber = {
    tag: number;
    flags: number;
    child: LabFiber | null;
    sibling: LabFiber | null;
    alternate: LabFiber | null;
  };
  const renderedComponents = (rootFiber: LabFiber): number => {
    let rendered = 0;
    const stack: [LabFiber, LabFiber | null][] = [[rootFiber, rootFiber.alternate]];
    for (let next = stack.pop(); next; next = stack.pop()) {
      const [fiber, previous] = next;
      if (COMPONENT_TAGS.has(fiber.tag) && (previous === null || (fiber.flags & PERFORMED_WORK) !== 0))
        rendered += 1;
      if (previous !== null && fiber.child === previous.child) continue;
      for (let child = fiber.child; child; child = child.sibling) stack.push([child, child.alternate]);
    }
    return rendered;
  };
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    configurable: true,
    value: {
      supportsFiber: true,
      isDisabled: false,
      renderers,
      inject(renderer: unknown): number {
        const id = renderers.size + 1;
        renderers.set(id, renderer);
        counts.reactRenderers = renderers.size;
        return id;
      },
      onCommitFiberRoot(_id: number, root: { current: LabFiber }): void {
        counts.reactCommits += 1;
        counts.componentRenders += renderedComponents(root.current);
      },
      onCommitFiberUnmount(): void {},
      onPostCommitFiberRoot(): void {},
      onScheduleFiberRoot(): void {},
      checkDCE(): void {},
    },
  });
  new MutationObserver((records) => {
    counts.domMutations += records.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const observe = (type: string, onEntry: (entry: PerformanceEntry) => void): void => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({
        type,
        buffered: false,
      });
    } catch {
      // An entry type the browser does not support stays at zero.
    }
  };
  observe('longtask', (entry) => {
    counts.longTasks += 1;
    counts.longTaskMs += entry.duration;
  });
  observe('long-animation-frame', () => {
    counts.longAnimationFrames += 1;
  });
  window.__werkflowLab = {
    reset: () => {
      counts.reactCommits = 0;
      counts.componentRenders = 0;
      counts.domMutations = 0;
      counts.longTasks = 0;
      counts.longTaskMs = 0;
      counts.longAnimationFrames = 0;
    },
    read: () => ({ ...counts }),
  };
}

export async function installLabProbe(page: Page): Promise<void> {
  await page.addInitScript(probeScript);
}

export async function resetLabProbe(page: Page): Promise<void> {
  await page.evaluate(() => window.__werkflowLab?.reset());
}
