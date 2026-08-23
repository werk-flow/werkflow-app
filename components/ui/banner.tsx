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
import { AlertCircle, CheckCircle, Info, Loader2, Undo2, X } from 'lucide-react';

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
  /** Icon rendered inside the action button (e.g. Undo2 for „Rückgängig"). */
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
  success:
    'bg-green-50 text-green-800 ring-green-200/50 dark:bg-green-950 dark:text-green-200 dark:ring-green-800/50',
  error:
    'bg-red-50 text-red-800 ring-red-200/50 dark:bg-red-950 dark:text-red-200 dark:ring-red-800/50',
  info: 'bg-blue-50 text-blue-800 ring-blue-200/50 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800/50',
  progress: 'bg-background text-foreground ring-border',
};

function BannerIcon({ variant }: { variant: BannerVariant }) {
  if (variant === 'success') return <CheckCircle className="size-5 shrink-0" />;
  if (variant === 'error') return <AlertCircle className="size-5 shrink-0" />;
  if (variant === 'info') return <Info className="size-5 shrink-0" />;
  return <Loader2 className="size-5 shrink-0 animate-spin" />;
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
        isExiting ? 'animate-banner-out' : 'animate-banner-in'
      )}
      role="alert"
      aria-live="assertive"
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg p-4 shadow-lg ring-1',
          VARIANT_CLASSES[banner.variant]
        )}
      >
        <BannerIcon variant={banner.variant} />
        <p className="flex-1 text-sm font-medium">{banner.message}</p>
        {banner.actionLabel && banner.onAction && (
          // A real button with an icon, not underlined text: the action (e.g.
          // „Rückgängig") must read as a clickable control at a glance.
          <button
            type="button"
            onClick={() => {
              banner.onAction?.();
              onDismiss();
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
          className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
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
  showBanner: (banner: ShowBannerInput) => void;
  dismissBanner: () => void;
};

const BannerContext = createContext<BannerContextValue | null>(null);

export function BannerProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const nextIdRef = useRef(1);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const exitRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimers = useCallback(() => {
    clearTimeout(autoDismissRef.current);
    clearTimeout(exitRef.current);
  }, []);

  const dismissBanner = useCallback(() => {
    clearTimeout(autoDismissRef.current);
    setIsExiting(true);
    clearTimeout(exitRef.current);
    exitRef.current = setTimeout(() => {
      setBanner(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);
  }, []);

  const showBanner = useCallback(
    ({ autoDismissMs, ...input }: ShowBannerInput) => {
      clearTimers();
      setIsExiting(false);
      setBanner({ ...input, id: nextIdRef.current++ });

      const dismissAfter =
        autoDismissMs === undefined ? resolveAutoDismissMs(input) : autoDismissMs;
      if (dismissAfter !== null) {
        autoDismissRef.current = setTimeout(dismissBanner, dismissAfter);
      }
    },
    [clearTimers, dismissBanner]
  );

  useEffect(() => clearTimers, [clearTimers]);

  const value = useMemo(
    () => ({ showBanner, dismissBanner }),
    [showBanner, dismissBanner]
  );

  return (
    <BannerContext.Provider value={value}>
      {children}
      {banner && (
        <Banner banner={banner} onDismiss={dismissBanner} isExiting={isExiting} />
      )}
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
  const exitRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    setIsExiting(true);
    clearTimeout(exitRef.current);
    exitRef.current = setTimeout(() => {
      setBanner(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);
  }, []);

  useEffect(() => {
    if (!paramValue) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the banner is intentionally derived once from the URL event before the param is removed
    setBanner({
      id: Date.now(),
      variant,
      message: messageTemplate.replace('{name}', paramValue),
    });
    setIsExiting(false);

    const url = new URL(window.location.href);
    url.searchParams.delete(paramKey);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [paramValue, paramKey, messageTemplate, router, variant]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(dismiss, STANDARD_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [banner, dismiss]);

  useEffect(() => () => clearTimeout(exitRef.current), []);

  if (!banner) return null;
  return <Banner banner={banner} onDismiss={dismiss} isExiting={isExiting} />;
}

/**
 * Success banner with an undo action, auto-dismissing after 5 s.
 * Prop-driven so callers can re-arm it per performed action.
 */
export function UndoBanner({
  banner,
  onDismiss,
  actionLabel = 'Rückgängig',
}: {
  banner: { id: number; message: string; onUndo: () => void } | null;
  onDismiss: () => void;
  actionLabel?: string;
}) {
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(onDismiss, ACTION_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [banner, onDismiss]);

  if (!banner) return null;
  return (
    <Banner
      banner={{
        id: banner.id,
        variant: 'success',
        message: banner.message,
        actionLabel,
        actionIcon: <Undo2 className="size-3.5" />,
        onAction: banner.onUndo,
      }}
      onDismiss={onDismiss}
    />
  );
}
