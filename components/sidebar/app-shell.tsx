'use client';

import { useState, useEffect, createContext, useContext, useMemo } from 'react';
import { SidebarLink as Link } from './sidebar-link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
// The drawer needs enter and exit animations only: `m` with the DOM animation
// features keeps the full `motion` component out of every route's bundle.
import { AnimatePresence, LazyMotion, domAnimation, m } from 'framer-motion';
import { Menu, X } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/organization/organization-context';
import { SidebarProfileCard } from '@/components/sidebar/sidebar-profile-card';
import { AttentionCountProvider, useAttentionCounts } from '@/components/realtime/attention-count-provider';
import type { AttentionCounts } from '@/lib/attention/types';
import { OrgSwitchOverlay } from './org-switch-overlay';
import { isNavItemActive, navItems } from './sidebar-nav-items';

const OrganizationSwitcher = dynamic(
  () => import('@/components/organization/organization-switcher').then((mod) => mod.OrganizationSwitcher),
  {
    ssr: false,
    loading: () => <Skeleton className="h-9 w-full rounded-md border border-input" />,
  },
);

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
      <nav className="flex-1 p-4">
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

// Sidebar content component (shared between desktop and mobile)
function SidebarContent({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const pathname = usePathname();
  const { activeOrg } = useOrganization();
  const { actionableCount, approvalsCount, unreadNotificationCount } = useAttentionCounts();

  const isAdminOrManager = activeOrg?.role === 'admin' || activeOrg?.role === 'buero';

  const visibleNavItems = navItems.filter((item) => !item.managerOrAbove || isAdminOrManager);

  const activePath = pathname;

  function handleNavClick() {
    onNavigate?.();
  }

  return (
    <>
      {/* Logo */}
      <div className="flex items-center justify-center px-4 py-5">
        <Link href="/dashboard" className="flex items-center" onClick={handleNavClick}>
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

      <Separator />

      {/* Organization Switcher */}
      <div className="p-4">
        <OrganizationSwitcher />
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 p-4">
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
                        className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary-text"
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

      {/* Profile card */}
      <div className="mt-auto border-t">
        <SidebarProfileCard />
      </div>
    </>
  );
}

// Wraps SidebarContent with a loading check for provider hydration
function DynamicSidebarContent({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { isLoading } = useOrganization();

  if (isLoading) {
    return <SidebarSkeleton />;
  }

  return <SidebarContent onNavigate={onNavigate} />;
}

// Desktop sidebar
function DesktopSidebar() {
  return (
    <aside className="hidden md:flex h-full w-64 shrink-0 flex-col border-r bg-card">
      <DynamicSidebarContent />
    </aside>
  );
}

// Mobile drawer overlay
function MobileDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  // Close on escape key, unless a menu inside the drawer (the profile card's)
  // already consumed it to close itself.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={onClose}
            />

            {/* Drawer */}
            <m.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              className="fixed left-0 top-0 z-50 h-full w-72 flex-col border-r bg-card shadow-xl md:hidden flex"
            >
              {/* Close button */}
              <div className="absolute right-2 top-2 z-10">
                <Button variant="ghost" size="icon" onClick={onClose} className="size-11">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Menü schließen</span>
                </Button>
              </div>

              <DynamicSidebarContent onNavigate={onClose} />
            </m.aside>
          </>
        )}
      </AnimatePresence>
    </LazyMotion>
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

      {/* Spacer to center logo */}
      <div className="size-11" />
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
  const { isSwitchingOrg } = useOrganization();

  return (
    <SidebarContext.Provider value={useMemo(() => ({ isOpen, setIsOpen }), [isOpen])}>
      <AttentionCountProvider
        initialCounts={initialAttentionCounts}
        initialOrganizationId={initialOrganizationId}
      >
        <div className="flex h-dvh w-full flex-col overflow-hidden overscroll-none bg-background md:flex-row">
          <MobileHeader />
          <DesktopSidebar />
          <MobileDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <main
              aria-hidden={isSwitchingOrg}
              className={cn('h-full overflow-hidden', isSwitchingOrg && 'pointer-events-none opacity-0')}
            >
              {children}
            </main>
            <OrgSwitchOverlay />
          </div>
        </div>
      </AttentionCountProvider>
    </SidebarContext.Provider>
  );
}
