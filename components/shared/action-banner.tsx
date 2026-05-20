'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, X } from 'lucide-react';

interface ActionBannerProps {
  /** The URL search param key to watch for (e.g. "deleted_job") */
  paramKey: string;
  /**
   * Message template — use {name} as a placeholder for the param value.
   * Example: 'Auftrag „{name}" wurde erfolgreich gelöscht.'
   */
  messageTemplate: string;
}

export function ActionBanner({ paramKey, messageTemplate }: ActionBannerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const paramValue = searchParams.get(paramKey);

  const [showBanner, setShowBanner] = useState(false);
  const [bannerMessage, setBannerMessage] = useState('');
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (paramValue) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the banner message is intentionally derived once from the URL event before the param is removed
      setBannerMessage(messageTemplate.replace('{name}', paramValue));
      setShowBanner(true);
      setIsExiting(false);

      const url = new URL(window.location.href);
      url.searchParams.delete(paramKey);
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [paramValue, paramKey, messageTemplate, router]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      setShowBanner(false);
      setIsExiting(false);
    }, 150);
  }, []);

  useEffect(() => {
    if (showBanner && !isExiting) {
      const timer = setTimeout(handleDismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [showBanner, isExiting, handleDismiss]);

  if (!showBanner) return null;

  return (
    <div className={`fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ${isExiting ? 'animate-banner-out' : 'animate-banner-in'}`}>
      <div className="flex items-center gap-3 rounded-lg bg-green-50 p-4 text-green-800 shadow-lg ring-1 ring-green-200/50 dark:bg-green-950 dark:text-green-200 dark:ring-green-800/50">
        <CheckCircle className="size-5 shrink-0" />
        <p className="flex-1 text-sm font-medium">{bannerMessage}</p>
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded-md p-1 hover:bg-green-100 dark:hover:bg-green-900 transition-colors"
          aria-label="Banner schließen"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
