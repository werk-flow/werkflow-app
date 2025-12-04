'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, X } from 'lucide-react';

export function OnboardingOrgDeletedBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get the org_deleted flag from URL
  const orgDeleted = searchParams.get('org_deleted');

  // Track if we should show the banner
  const [showBanner, setShowBanner] = useState(false);

  // Track if banner is exiting (for fade-out animation)
  const [isExiting, setIsExiting] = useState(false);

  // Initialize from URL on mount
  useEffect(() => {
    if (orgDeleted === 'true') {
      setShowBanner(true);
      setIsExiting(false);
      // Clean up the URL by removing the query param
      const url = new URL(window.location.href);
      url.searchParams.delete('org_deleted');
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [orgDeleted, router]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    // Wait for fade-out animation to complete before hiding
    setTimeout(() => {
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
    <div className={`fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ${isExiting ? 'animate-out' : 'animate-in'}`}>
      <div className="flex items-center gap-3 rounded-lg bg-green-50 p-4 text-green-800 shadow-lg ring-1 ring-green-200/50 dark:bg-green-950 dark:text-green-200 dark:ring-green-800/50">
        <CheckCircle className="size-5 shrink-0" />
        <p className="flex-1 text-sm font-medium">
          Die Organisation wurde erfolgreich gelöscht.
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

