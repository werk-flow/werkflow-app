'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Info, X } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';

export function AlreadyMemberBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { activeOrgId } = useOrganization();

  // Get the already_member org ID from URL
  const alreadyMemberOrgId = searchParams.get('already_member');

  // Track if we should show the banner
  const [showBanner, setShowBanner] = useState(false);

  // Track if banner is exiting (for fade-out animation)
  const [isExiting, setIsExiting] = useState(false);

  // Track if user has dismissed the banner
  const [isDismissed, setIsDismissed] = useState(false);

  // Track the org ID (to persist across org switches)
  const [alreadyMemberOrgIdState, setAlreadyMemberOrgIdState] = useState<string | null>(null);

  // Initialize the org ID from URL on mount
  useEffect(() => {
    if (alreadyMemberOrgId) {
      setAlreadyMemberOrgIdState(alreadyMemberOrgId);
      setIsDismissed(false); // Reset dismissed state
      setIsExiting(false); // Reset exiting state
      // Clean up the URL by removing the query param (but keep the state)
      const url = new URL(window.location.href);
      url.searchParams.delete('already_member');
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [alreadyMemberOrgId, router]);

  // Show/hide banner based on whether the active org matches
  useEffect(() => {
    if (alreadyMemberOrgIdState && activeOrgId && !isDismissed) {
      setShowBanner(activeOrgId === alreadyMemberOrgIdState);
    } else if (!isExiting) {
      setShowBanner(false);
    }
  }, [activeOrgId, alreadyMemberOrgIdState, isDismissed, isExiting]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    // Wait for fade-out animation to complete before hiding
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
    <div className={`fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ${isExiting ? 'animate-out' : 'animate-in'}`}>
      <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-4 text-blue-800 shadow-lg ring-1 ring-blue-200/50 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800/50">
        <Info className="size-5 shrink-0" />
        <p className="flex-1 text-sm font-medium">
          Du bist bereits Teil dieser Organisation.
        </p>
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded-md p-1 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
          aria-label="Banner schließen"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

