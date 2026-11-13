'use client';

import {
  useState,
  useEffect,
  useRef,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { SidebarLink as Link } from './sidebar-link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Menu } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { logError } from '@/lib/logging';
import { restoreOfflineShell } from '@/lib/offline/service-worker-caches';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/organization/organization-context';
import { SidebarProfileCard } from '@/components/sidebar/sidebar-profile-card';
import { usePageBodyKeyboardScroll } from '@/components/shared/page-body-keyboard-scroll';
import { AttentionCountProvider, useAttentionCounts } from '@/components/realtime/attention-count-provider';
import { ProblemReportButton } from '@/components/problem-reports/problem-report-button';
import { ProblemReportLauncher } from '@/components/problem-reports/problem-report-launcher';
import type { AttentionCounts } from '@/lib/attention/types';
import { MobileDrawer } from './mobile-drawer';
import { OrgSwitchOverlay } from './org-switch-overlay';
import { UnsentWorkHost } from '@/components/shared/unsent-work-host';
import { isNavItemActive, navItemsFor } from './sidebar-nav-items';

const OrganizationSwitcher = dynamic(
  () => import('@/components/organization/organization-switcher').then((mod) => mod.OrganizationSwitcher),
  {
    ssr: false,
    loading: () => <Skeleton className="h-9 w-full rounded-md border border-input" />,
  },
);

const IosInstallHint = dynamic(
  () => import('@/components/shared/ios-install-hint').then((mod) => mod.IosInstallHint),
  { ssr: false },
);

const subscribeNever = (): (() => void) => () => {};
const onServer = (): boolean => false;

/**
 * iOS browsers have no install prompt, so the field role gets a hint there,
 * outside the installed app. iPadOS reports a Mac with touch. Every other
 * browser never downloads the hint's module.
 */
function needsIosInstallHint(): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * The installable app shell's page side, run after the load event so it adds
 * nothing to the first paint. It registers the service worker (production
 * only: development files change on every edit) and asks it to refill its
 * cookie-free shell: signing in navigates on the client, so a shell a sign-out
 * deleted comes back here. Every cold start needs this much; the iOS hint runs
 * only sometimes and loads lazily, since a chunk loaded after the load event
 * still costs the cold start a request. The cache clear is the exception: a
 * sign-out must never wait for a chunk, so it is a small static import.
 */
function useOfflineShell(): void {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const start = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then(restoreOfflineShell)
        .catch((error: unknown) => logError('AppShell: service worker registration failed', error));
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => window.removeEventListener('load', start);
  }, []);
}

// Context for sidebar state
type SidebarContextType = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextType | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within AppShell');
  }
  return context;
}

// Sidebar skeleton shown while providers are hydrating
function SidebarSkeleton() {
  return (
    <>
      <div className="flex items-center justify-center px-4 py-5">
        <Image
          src="/logo-text-light.svg"
          alt="WerkFlow"
          width={160}
          height={35}
          className="h-9 w-auto dark:hidden"
          priority
        />
        <Image
          src="/logo-text-dark.svg"
          alt="WerkFlow"
          width={160}
          height={35}
          className="hidden h-9 w-auto dark:block"
          priority
        />
      </div>
      <Separator />
      <div className="p-4">
        <Skeleton className="h-9 w-full rounded-md border border-input" />
      </div>
      <Separator />
      <nav aria-label="Hauptnavigation" className="flex-1 p-4">
        <ul className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <div className="flex items-center gap-3 rounded-md px-3 py-2">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-24 rounded" />
              </div>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto border-t">
        <div className="flex items-center gap-3 p-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-24 mb-1 rounded" />
            <Skeleton className="h-3 w-32 rounded" />
          </div>
        </div>
      </div>
    </>
  );
}

function SidebarLogo({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex items-center justify-center px-4 py-5">
      <Link href="/dashboard" className="flex items-center" onClick={onClick}>
        <Image
          src="/logo-text-light.svg"
          alt="WerkFlow"
          width={160}
          height={35}
          className="h-9 w-auto dark:hidden"
          priority
        />
        <Image
          src="/logo-text-dark.svg"
          alt="WerkFlow"
          width={160}
          height={35}
          className="hidden h-9 w-auto dark:block"
          priority
        />
      </Link>
    </div>
  );
}

/** What the phone menu does on a navigation and on its report row. */
type SidebarPresses = { onNavigate?: (() => void) | undefined; onReport?: (() => void) | undefined };

// Sidebar content component (shared between desktop and mobile)
function SidebarContent({ onNavigate, onReport }: SidebarPresses) {
  const pathname = usePathname();
  const { activeOrg } = useOrganization();
  const { actionableCount, approvalsCount, unreadNotificationCount } = useAttentionCounts();

  const visibleNavItems = navItemsFor(activeOrg?.role);

  const activePath = pathname;

  function handleNavClick() {
    onNavigate?.();
  }

  return (
    <>
      <SidebarLogo onClick={handleNavClick} />

      <Separator />

      {/* Organization Switcher */}
      <div className="p-4">
        <OrganizationSwitcher />
      </div>

      <Separator />

      {/* Navigation */}
      <nav aria-label="Hauptnavigation" className="flex-1 p-4">
        <ul className="space-y-1">
          {visibleNavItems.map((item) => {
            const isActive = isNavItemActive(item, activePath);
            const Icon = item.icon;
            // Badges are viewer-scoped: the counts already exclude everything
            // the viewer cannot act on, so no extra role gate is needed.
            const badgeCount =
              item.href === '/aufgaben'
                ? actionableCount + unreadNotificationCount
                : item.href === '/zeiterfassung'
                  ? approvalsCount
                  : 0;
            const showBadge = badgeCount > 0;
            const badgeLabel =
              item.href === '/aufgaben'
                ? `${badgeCount} offene Aufgaben und Benachrichtigungen`
                : `${badgeCount} ausstehende Freigaben`;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={handleNavClick}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-foreground'
                      : 'font-normal text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  {showBadge && (
                    <>
                      <span
                        aria-hidden="true"
                        data-testid="sidebar-badge"
                        className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-xs font-semibold text-primary-text"
                      >
                        {badgeCount}
                      </span>
                      <span className="sr-only">{badgeLabel}</span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <ProblemReportButton placement="sidebar" onPress={onReport} />

      {/* Profile card */}
      <div className="mt-auto border-t">
        <SidebarProfileCard />
      </div>
    </>
  );
}

// Wraps SidebarContent with a loading check for provider hydration
function DynamicSidebarContent({ onNavigate, onReport }: SidebarPresses) {
  const { isLoading } = useOrganization();

  if (isLoading) {
    return <SidebarSkeleton />;
  }

  return <SidebarContent onNavigate={onNavigate} onReport={onReport} />;
}

// Desktop sidebar
function DesktopSidebar() {
  return (
    <aside
      aria-label="Seitenleiste"
      className="hidden md:flex h-full w-64 shrink-0 flex-col border-r bg-card"
    >
      <DynamicSidebarContent />
    </aside>
  );
}

// Mobile header with hamburger menu
function MobileHeader() {
  const { isOpen, setIsOpen } = useSidebar();

  return (
    <header className="flex md:hidden items-center justify-between border-b bg-card px-4 py-2 sticky top-0 z-30">
      <Button variant="ghost" size="icon" onClick={() => setIsOpen(!isOpen)} className="-ml-1 size-11">
        <Menu className="h-5 w-5" />
        <span className="sr-only">Menü öffnen</span>
      </Button>

      <Link href="/dashboard" className="flex items-center">
        {/* Light mode logo */}
        <Image
          src="/logo-text-light.svg"
          alt="WerkFlow"
          width={120}
          height={26}
          className="h-7 w-auto dark:hidden"
          priority
        />
        {/* Dark mode logo */}
        <Image
          src="/logo-text-dark.svg"
          alt="WerkFlow"
          width={120}
          height={26}
          className="hidden h-7 w-auto dark:block"
          priority
        />
      </Link>

      <ProblemReportButton placement="header" />
    </header>
  );
}

// Main app shell component — static frame with no direct data dependencies
export function AppShell({
  children,
  initialAttentionCounts,
  initialOrganizationId,
}: {
  children: React.ReactNode;
  initialAttentionCounts?: AttentionCounts;
  initialOrganizationId?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const closeDrawer = useCallback(() => setIsOpen(false), []);
  const { isSwitchingOrg, activeOrg } = useOrganization();
  const showIosInstallHint = useSyncExternalStore(subscribeNever, needsIosInstallHint, onServer);
  useOfflineShell();
  const mainRef = useRef<HTMLElement>(null);
  usePageBodyKeyboardScroll(mainRef);

  return (
    <SidebarContext.Provider value={useMemo(() => ({ isOpen, setIsOpen }), [isOpen])}>
      <AttentionCountProvider
        initialCounts={initialAttentionCounts}
        initialOrganizationId={initialOrganizationId}
      >
        <ProblemReportLauncher>
          <div className="flex h-dvh w-full flex-col overflow-hidden overscroll-none bg-background md:flex-row">
            <MobileHeader />
            <DesktopSidebar />
            <MobileDrawer isOpen={isOpen} onClose={closeDrawer}>
              {(report) => <DynamicSidebarContent onNavigate={closeDrawer} onReport={report} />}
            </MobileDrawer>
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
              <main
                ref={mainRef}
                aria-hidden={isSwitchingOrg}
                // The field worker's phone gets 44 px touch targets (components/ui/field-worker-targets.ts).
                data-field-worker={activeOrg?.role === 'employee' ? '' : undefined}
                className={cn('h-full overflow-hidden', isSwitchingOrg && 'pointer-events-none opacity-0')}
              >
                {children}
              </main>
              <OrgSwitchOverlay />
              {activeOrg?.role === 'employee' && showIosInstallHint && <IosInstallHint />}
            </div>
          </div>
          <UnsentWorkHost />
        </ProblemReportLauncher>
      </AttentionCountProvider>
    </SidebarContext.Provider>
  );
}
