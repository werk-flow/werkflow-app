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
import { AlertCircle, CheckCircle, X } from 'lucide-react';

type SettingsBannerVariant = 'success' | 'error';

type SettingsBanner = {
  id: number;
  message: string;
  variant: SettingsBannerVariant;
};

type SettingsBannerContextValue = {
  showBanner: (banner: Omit<SettingsBanner, 'id'>) => void;
};

const SettingsBannerContext = createContext<SettingsBannerContextValue | null>(
  null
);

const AUTO_DISMISS_MS = 3000;
const EXIT_ANIMATION_MS = 150;

export function SettingsBannerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [banner, setBanner] = useState<SettingsBanner | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const exitRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimers = useCallback(() => {
    clearTimeout(autoDismissRef.current);
    clearTimeout(exitRef.current);
  }, []);

  const dismissBanner = useCallback(() => {
    setIsExiting(true);
    clearTimeout(exitRef.current);
    exitRef.current = setTimeout(() => {
      setBanner(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);
  }, []);

  const showBanner = useCallback(
    ({ message, variant }: Omit<SettingsBanner, 'id'>) => {
      clearTimers();
      setIsExiting(false);
      setBanner({
        id: Date.now(),
        message,
        variant,
      });
    },
    [clearTimers]
  );

  useEffect(() => {
    if (!banner || isExiting) {
      return;
    }

    autoDismissRef.current = setTimeout(() => {
      dismissBanner();
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(autoDismissRef.current);
  }, [banner, dismissBanner, isExiting]);

  useEffect(() => clearTimers, [clearTimers]);

  const value = useMemo<SettingsBannerContextValue>(
    () => ({
      showBanner,
    }),
    [showBanner]
  );

  return (
    <SettingsBannerContext.Provider value={value}>
      {children}
      {banner ? (
        <div
          className={`fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ${
            isExiting ? 'animate-banner-out' : 'animate-banner-in'
          }`}
        >
          <div
            className={`flex items-center gap-3 rounded-lg p-4 shadow-lg ring-1 ${
              banner.variant === 'success'
                ? 'bg-green-50 text-green-800 ring-green-200/50 dark:bg-green-950 dark:text-green-200 dark:ring-green-800/50'
                : 'bg-red-50 text-red-800 ring-red-200/50 dark:bg-red-950 dark:text-red-200 dark:ring-red-800/50'
            }`}
          >
            {banner.variant === 'success' ? (
              <CheckCircle className="size-5 shrink-0" />
            ) : (
              <AlertCircle className="size-5 shrink-0" />
            )}
            <p className="flex-1 text-sm font-medium">{banner.message}</p>
            <button
              type="button"
              onClick={dismissBanner}
              className={`shrink-0 rounded-md p-1 transition-colors ${
                banner.variant === 'success'
                  ? 'hover:bg-green-100 dark:hover:bg-green-900'
                  : 'hover:bg-red-100 dark:hover:bg-red-900'
              }`}
              aria-label="Banner schließen"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </SettingsBannerContext.Provider>
  );
}

export function useSettingsBanner() {
  const context = useContext(SettingsBannerContext);

  if (!context) {
    throw new Error(
      'useSettingsBanner must be used within a SettingsBannerProvider'
    );
  }

  return context;
}
