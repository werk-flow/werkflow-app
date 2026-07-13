'use client';

import {
  useState,
  useEffect,
  createContext,
  useContext,
  useMemo
} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard, Users, Menu, X, Calendar, Clock, Building2, Briefcase, FileText, Boxes } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/organization/organization-context';
import { DashboardPageSkeleton } from '@/components/loading-states/dashboard-page-skeleton';
import { MitarbeiterPageSkeleton } from '@/components/loading-states/mitarbeiter-page-skeleton';
import { KalenderPageSkeleton } from '@/components/loading-states/kalender-page-skeleton';
import { ZeiterfassungPageSkeleton } from '@/components/loading-states/zeiterfassung-page-skeleton';
import { KundenPageSkeleton } from '@/components/loading-states/kunden-page-skeleton';
import { AuftraegePageSkeleton } from '@/components/loading-states/auftraege-page-skeleton';
import { DokumentePageSkeleton } from '@/components/loading-states/dokumente-page-skeleton';
import { InventarPageSkeleton } from '@/components/loading-states/inventar-page-skeleton';
import { SidebarProfileCard } from '@/components/sidebar/sidebar-profile-card';
import {
  PendingApprovalCountProvider,
  usePendingApprovalCount,
} from '@/components/realtime/pending-approval-count-provider';

const OrganizationSwitcher = dynamic(
  () =>
    import('@/components/organization/organization-switcher').then(
      (mod) => mod.OrganizationSwitcher
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-9 w-full rounded-md border border-input bg-muted animate-pulse" />
    )
  }
);

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** If true, only admins and managers can see this item */
  managerOrAbove?: boolean;
};

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard
  },
  {
    href: '/kalender',
    label: 'Kalender',
    icon: Calendar
  },
  {
    href: '/zeiterfassung',
    label: 'Zeiterfassung',
    icon: Clock
  },
  {
    href: '/auftraege',
    label: 'Aufträge',
    icon: Briefcase
  },
  {
    href: '/dokumente',
    label: 'Dokumente',
    icon: FileText,
    managerOrAbove: true
  },
  {
    href: '/inventar',
    label: 'Inventar',
    icon: Boxes,
    managerOrAbove: true
  },
  {
    href: '/mitarbeiter',
    label: 'Mitarbeiter',
    icon: Users,
    managerOrAbove: true
  },
  {
    href: '/kunden',
    label: 'Kunden',
    icon: Building2,
    managerOrAbove: true
  }
];

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
        <div className="h-9 w-full rounded-md border border-input bg-muted animate-pulse" />
      </div>
      <Separator />
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <div className="flex items-center gap-3 rounded-md px-3 py-2">
                <div className="size-4 rounded bg-muted animate-pulse" />
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto border-t">
        <div className="flex items-center gap-3 p-3">
          <div className="size-9 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="h-4 w-24 mb-1 rounded bg-muted animate-pulse" />
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    </>
  );
}

// Sidebar content component (shared between desktop and mobile)
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { activeOrg } = useOrganization();
  const { pendingApprovalCount } = usePendingApprovalCount();

  const isAdminOrManager =
    activeOrg?.role === 'admin' || activeOrg?.role === 'buero';

  const visibleNavItems = navItems.filter(
    (item) => !item.managerOrAbove || isAdminOrManager
  );

  const activePath = pathname;

  function handleNavClick() {
    onNavigate?.();
  }

  return (
    <>
      {/* Logo */}
      <div className="flex items-center justify-center px-4 py-5">
        <Link
          href="/dashboard"
          className="flex items-center"
          onClick={handleNavClick}
        >
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
            const isActive =
              activePath === item.href || activePath.startsWith(item.href + '/');
            const Icon = item.icon;
            const showBadge =
              item.href === '/zeiterfassung' &&
              isAdminOrManager &&
              pendingApprovalCount > 0;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={handleNavClick}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-foreground'
                      : 'font-normal text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  {showBadge && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                      {pendingApprovalCount}
                    </span>
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
function DynamicSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
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
function MobileDrawer({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            className="fixed left-0 top-0 z-50 h-full w-72 flex-col border-r bg-card shadow-xl md:hidden flex"
          >
            {/* Close button */}
            <div className="absolute right-2 top-2 z-10">
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Menü schließen</span>
              </Button>
            </div>

            <DynamicSidebarContent onNavigate={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// Mobile header with hamburger menu
function MobileHeader() {
  const { isOpen, setIsOpen } = useSidebar();

  return (
    <header className="flex md:hidden items-center justify-between border-b bg-card px-4 py-3 sticky top-0 z-30">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="h-9 w-9"
      >
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
      <div className="w-9" />
    </header>
  );
}

// Org-switching skeleton overlay (isolated so AppShell stays data-free)
function OrgSwitchOverlay() {
  const { isSwitchingOrg } = useOrganization();
  const pathname = usePathname();

  const currentSkeleton = useMemo(() => {
    if (pathname.startsWith('/mitarbeiter')) return <MitarbeiterPageSkeleton />;
    if (pathname.startsWith('/dashboard')) return <DashboardPageSkeleton />;
    if (pathname.startsWith('/kalender')) return <KalenderPageSkeleton />;
    if (pathname.startsWith('/zeiterfassung')) return <ZeiterfassungPageSkeleton />;
    if (pathname.startsWith('/kunden')) return <KundenPageSkeleton />;
    if (pathname.startsWith('/auftraege')) return <AuftraegePageSkeleton />;
    if (pathname.startsWith('/dokumente')) return <DokumentePageSkeleton />;
    if (pathname === '/inventar' || pathname.startsWith('/inventar/')) {
      return <InventarPageSkeleton />;
    }
    return null;
  }, [pathname]);

  if (!isSwitchingOrg || !currentSkeleton) return null;

  return (
    <div className="absolute inset-0 z-50 overflow-auto bg-background">
      {currentSkeleton}
    </div>
  );
}

// Main app shell component — static frame with no direct data dependencies
export function AppShell({
  children,
  initialPendingApprovalCount,
  initialOrganizationId,
}: {
  children: React.ReactNode;
  initialPendingApprovalCount?: number;
  initialOrganizationId?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { isSwitchingOrg } = useOrganization();

  return (
    <SidebarContext.Provider value={useMemo(() => ({ isOpen, setIsOpen }), [isOpen])}>
      <PendingApprovalCountProvider
        initialPendingApprovalCount={initialPendingApprovalCount}
        initialOrganizationId={initialOrganizationId}
      >
        <div className="flex h-screen flex-col bg-background md:flex-row">
          <MobileHeader />
          <DesktopSidebar />
          <MobileDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <main
              aria-hidden={isSwitchingOrg}
              className={cn(
                'h-full overflow-hidden',
                isSwitchingOrg && 'pointer-events-none opacity-0'
              )}
            >
              {children}
            </main>
            <OrgSwitchOverlay />
          </div>
        </div>
      </PendingApprovalCountProvider>
    </SidebarContext.Provider>
  );
}
