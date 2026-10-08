'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * The one feedback banner (feedback canon in the werkflow-design skill).
 * Top-center, dismissible, four variants. Timings live here, not at call
 * sites: 3 s standard, 5 s with an action button, `error` and `progress`
 * persist until dismissed or replaced.
 */

export type BannerVariant = 'success' | 'error' | 'info' | 'progress';

export type BannerState = {
  id: number;
  variant: BannerVariant;
  message: string;
  actionLabel?: string;
  /** Icon rendered inside the action button (e.g. Undo2 for „Rückgängig“). */
  actionIcon?: ReactNode;
  onAction?: () => void;
};

const STANDARD_DISMISS_MS = 3000;
const ACTION_DISMISS_MS = 5000;
const EXIT_ANIMATION_MS = 150;

function resolveAutoDismissMs(banner: Omit<BannerState, 'id'>): number | null {
  if (banner.variant === 'error' || banner.variant === 'progress') return null;
  return banner.actionLabel ? ACTION_DISMISS_MS : STANDARD_DISMISS_MS;
}

const VARIANT_CLASSES: Record<BannerVariant, string> = {
  success: 'bg-success-soft text-success-soft-foreground ring-success/40',
  error: 'bg-destructive-soft text-destructive-soft-foreground ring-destructive/40',
  info: 'bg-info-soft text-info-soft-foreground ring-info/40',
  progress: 'bg-background text-foreground ring-border',
};

function BannerIcon({ variant }: { variant: BannerVariant }) {
  if (variant === 'success') return <CheckCircle className="size-5 shrink-0" />;
  if (variant === 'error') return <AlertCircle className="size-5 shrink-0" />;
  if (variant === 'info') return <Info className="size-5 shrink-0" />;
  return <Spinner className="size-5 shrink-0" />;
}

/** Presentational banner. Prefer `useBanner()`; use directly only in wrappers. */
export function Banner({
  banner,
  onDismiss,
  isExiting = false,
}: {
  banner: BannerState;
  onDismiss: () => void;
  isExiting?: boolean;
}) {
  return (
    <div
      // CENTERING INVARIANT: `left-1/2 -translate-x-1/2` is the ONLY source
      // of horizontal centering. The banner keyframes in app/globals.css
      // animate opacity + translateY only and must never gain an x-shift —
      // Tailwind v4's translate utility (the `translate` property) COMPOSES
      // with the animation's `transform`, so an x-shift in the keyframes
      // pushes the banner off-center. Change neither side without the other.
      className={cn(
        'fixed left-1/2 top-4 z-[120] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2',
        isExiting ? 'animate-banner-out' : 'animate-banner-in',
      )}
      role={isExiting ? undefined : 'alert'}
      aria-live={isExiting ? 'off' : banner.variant === 'error' ? 'assertive' : 'polite'}
      aria-hidden={isExiting || undefined}
      inert={isExiting || undefined}
      data-banner-id={banner.id}
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg ring-1',
          VARIANT_CLASSES[banner.variant],
        )}
      >
        <BannerIcon variant={banner.variant} />
        <p className="min-w-0 flex-1 break-words text-sm">{banner.message}</p>
        {banner.actionLabel && banner.onAction && (
          // A real button with an icon, not underlined text: the action (e.g.
          // „Rückgängig“) must read as a clickable control at a glance.
          <button
            type="button"
            onClick={() => {
              onDismiss();
              banner.onAction?.();
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-current/25 bg-white/40 px-2.5 py-1 text-sm font-semibold transition-colors hover:bg-white/70 dark:bg-white/10 dark:hover:bg-white/20"
          >
            {banner.actionIcon}
            {banner.actionLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          // Distinct from action buttons and dialog closes named „Schließen" —
          // two identical labels on one screen are ambiguous for screen
          // readers and break strict-mode test locators.
          aria-label="Hinweis schließen"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

type ShowBannerInput = {
  variant: BannerVariant;
  message: string;
  actionLabel?: string;
  actionIcon?: ReactNode;
  onAction?: () => void;
  /** Override the encoded timing; `null` persists until dismissed/replaced. */
  autoDismissMs?: number | null;
};

type BannerContextValue = {
  showBanner: (banner: ShowBannerInput) => () => void;
  dismissBanner: () => void;
};

const BannerContext = createContext<BannerContextValue | null>(null);

export function BannerProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [outgoing, setOutgoing] = useState<BannerState | null>(null);
  const currentRef = useRef<BannerState | null>(null);
  const outgoingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextIdRef = useRef(1);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exitRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimers = useCallback(() => {
    clearTimeout(autoDismissRef.current);
    clearTimeout(exitRef.current);
    clearTimeout(outgoingTimerRef.current);
  }, []);

  const dismissBanner = useCallback(() => {
    clearTimeout(autoDismissRef.current);
    setIsExiting(true);
    clearTimeout(exitRef.current);
    exitRef.current = setTimeout(() => {
      setBanner(null);
      currentRef.current = null;
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);
  }, []);

  const showBanner = useCallback(
    ({ autoDismissMs, ...input }: ShowBannerInput) => {
      clearTimers();
      setIsExiting(false);
      setOutgoing(currentRef.current);
      const next = { ...input, id: nextIdRef.current++ };
      currentRef.current = next;
      setBanner(next);
      outgoingTimerRef.current = setTimeout(() => setOutgoing(null), EXIT_ANIMATION_MS);

      const dismissAfter = autoDismissMs === undefined ? resolveAutoDismissMs(input) : autoDismissMs;
      if (dismissAfter !== null) {
        autoDismissRef.current = setTimeout(dismissBanner, dismissAfter);
      }
      // Disposal belongs to this message, never to a newer caller's feedback.
      return () => {
        if (currentRef.current?.id === next.id) dismissBanner();
      };
    },
    [clearTimers, dismissBanner],
  );

  useEffect(() => clearTimers, [clearTimers]);

  const value = useMemo(() => ({ showBanner, dismissBanner }), [showBanner, dismissBanner]);

  return (
    <BannerContext.Provider value={value}>
      {children}
      {outgoing && <Banner key={outgoing.id} banner={outgoing} onDismiss={() => {}} isExiting />}
      {banner && <Banner key={banner.id} banner={banner} onDismiss={dismissBanner} isExiting={isExiting} />}
    </BannerContext.Provider>
  );
}

export function useBanner(): BannerContextValue {
  const context = useContext(BannerContext);
  if (!context) {
    throw new Error('useBanner requires a BannerProvider in the tree.');
  }
  return context;
}

/**
 * Post-redirect confirmation: watches a URL search param, shows a success
 * banner once, and strips the param. The delete flows' „redirect + green
 * banner" convention, on the shared primitive.
 *
 * Pages must render this inside a Suspense boundary (useSearchParams).
 */
export function UrlFlashBanner({
  paramKey,
  messageTemplate,
  variant = 'success',
}: {
  /** The URL search param key to watch (e.g. "deleted_job"). */
  paramKey: string;
  /** Message template; `{name}` is replaced with the param value. */
  messageTemplate: string;
  /** Post-redirect confirmations are green; `info` covers neutral notices. */
  variant?: 'success' | 'info';
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const paramValue = searchParams.get(paramKey);

  const [banner, setBanner] = useState<BannerState | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  // The banner derives from the param during render, never in an effect. An
  // effect that runs in a hydration commit inherits that commit's priority:
  // at idle priority its update waited behind the page's background work,
  // the param was stripped meanwhile, and the confirmation never showed.
  const [shownParam, setShownParam] = useState<string | null>(null);
  if (paramValue !== shownParam) {
    setShownParam(paramValue);
    if (paramValue) {
      setBanner({
        id: (banner?.id ?? 0) + 1,
        variant,
        message: messageTemplate.replace('{name}', paramValue),
      });
      setIsExiting(false);
    }
  }

  const dismiss = useCallback(() => setIsExiting(true), []);

  useEffect(() => {
    if (!paramValue) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(paramKey);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [paramValue, paramKey, router]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(dismiss, STANDARD_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [banner, dismiss]);

  // A banner arriving during the exit sets `isExiting` back and cancels the removal.
  useEffect(() => {
    if (!isExiting) return;
    const timer = setTimeout(() => {
      setBanner(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [isExiting]);

  if (!banner) return null;
  return <Banner key={banner.id} banner={banner} onDismiss={dismiss} isExiting={isExiting} />;
}
