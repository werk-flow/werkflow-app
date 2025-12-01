'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, X } from 'lucide-react';

export function OrgDeletedBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get the org_deleted flag from URL
  const orgDeleted = searchParams.get('org_deleted');

  // Track if we should show the banner
  const [showBanner, setShowBanner] = useState(false);

  // Initialize from URL on mount
  useEffect(() => {
    if (orgDeleted === 'true') {
      setShowBanner(true);
      // Clean up the URL by removing the query param
      const url = new URL(window.location.href);
      url.searchParams.delete('org_deleted');
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [orgDeleted, router]);

  // Auto-dismiss banner after 3 seconds
  useEffect(() => {
    if (showBanner) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showBanner]);

  const handleDismiss = () => {
    setShowBanner(false);
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-950 dark:text-green-200">
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
  );
}

