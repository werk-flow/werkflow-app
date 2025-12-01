'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, X } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';

export function JoinedBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { activeOrgId } = useOrganization();

  // Get the joined org ID from URL
  const joinedOrgId = searchParams.get('joined');

  // Track if we should show the banner
  const [showBanner, setShowBanner] = useState(false);

  // Track if user has dismissed the banner
  const [isDismissed, setIsDismissed] = useState(false);

  // Track the org ID that was joined (to persist across org switches)
  const [joinedOrgIdState, setJoinedOrgIdState] = useState<string | null>(null);

  // Initialize the joined org ID from URL on mount
  useEffect(() => {
    if (joinedOrgId) {
      setJoinedOrgIdState(joinedOrgId);
      setIsDismissed(false); // Reset dismissed state for new joins
      // Clean up the URL by removing the query param (but keep the state)
      const url = new URL(window.location.href);
      url.searchParams.delete('joined');
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [joinedOrgId, router]);

  // Show/hide banner based on whether the active org matches the joined org
  useEffect(() => {
    if (joinedOrgIdState && activeOrgId && !isDismissed) {
      setShowBanner(activeOrgId === joinedOrgIdState);
    } else {
      setShowBanner(false);
    }
  }, [activeOrgId, joinedOrgIdState, isDismissed]);

  // Auto-dismiss banner after 8 seconds
  useEffect(() => {
    if (showBanner) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showBanner]);

  const handleDismiss = () => {
    setIsDismissed(true);
    setShowBanner(false);
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-950 dark:text-green-200">
      <CheckCircle className="size-5 shrink-0" />
      <p className="flex-1 text-sm font-medium">
        Du wurdest erfolgreich zu dieser Organisation hinzugefügt.
      </p>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 hover:bg-green-100 dark:hover:bg-green-900 transition-colors"
        aria-label="Banner schließen"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
