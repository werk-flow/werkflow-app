'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, X } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';

export function CreatedOrgBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { activeOrgId } = useOrganization();

  // Get the created org ID from URL
  const createdOrgId = searchParams.get('created');

  // Track if banner is exiting (for fade-out animation)
  const [isExiting, setIsExiting] = useState(false);

  // Track if we should show the banner
  const [showBanner, setShowBanner] = useState(false);

  // Track if user has dismissed the banner
  const [isDismissed, setIsDismissed] = useState(false);

  // Track the org ID that was created (to persist across org switches)
  const [createdOrgIdState, setCreatedOrgIdState] = useState<string | null>(null);

  useEffect(() => {
    if (createdOrgId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this banner intentionally latches a one-shot URL event before removing the search param
      setCreatedOrgIdState(createdOrgId);
      setIsDismissed(false);
      setIsExiting(false);
      const url = new URL(window.location.href);
      url.searchParams.delete('created');
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [createdOrgId, router]);

  useEffect(() => {
    if (createdOrgIdState && activeOrgId && !isDismissed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the visible state mirrors the active org match for this latched URL event
      setShowBanner(activeOrgId === createdOrgIdState);
    } else if (!isExiting) {
      setShowBanner(false);
    }
  }, [activeOrgId, createdOrgIdState, isDismissed, isExiting]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      setIsDismissed(true);
      setShowBanner(false);
      setIsExiting(false);
    }, 150);
  }, []);

  // Auto-dismiss banner after 3 seconds
  useEffect(() => {
    if (showBanner && !isExiting) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showBanner, isExiting, handleDismiss]);

  if (!showBanner) {
    return null;
  }

  return (
    <div className={`fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ${isExiting ? 'animate-banner-out' : 'animate-banner-in'}`}>
      <div className="flex items-center gap-3 rounded-lg bg-green-50 p-4 text-green-800 shadow-lg ring-1 ring-green-200/50 dark:bg-green-950 dark:text-green-200 dark:ring-green-800/50">
        <CheckCircle className="size-5 shrink-0" />
        <p className="flex-1 text-sm font-medium">
          Organisation erstellt — Du bist jetzt Admin.
        </p>
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



