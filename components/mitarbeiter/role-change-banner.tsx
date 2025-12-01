'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, X } from 'lucide-react';

import { getRoleLabel } from '@/lib/roles';
import type { OrgRole } from '@/lib/members/actions';

export function RoleChangeBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get the role change info from URL
  const memberName = searchParams.get('role_changed_member');
  const newRole = searchParams.get('new_role') as OrgRole | null;

  // Track if we should show the banner
  const [showBanner, setShowBanner] = useState(false);

  // Track banner data
  const [bannerData, setBannerData] = useState<{
    memberName: string;
    newRole: OrgRole;
  } | null>(null);

  // Initialize the banner data from URL on mount
  useEffect(() => {
    if (memberName && newRole) {
      setBannerData({ memberName, newRole });
      setShowBanner(true);
      // Clean up the URL by removing the query params (but keep the state)
      const url = new URL(window.location.href);
      url.searchParams.delete('role_changed_member');
      url.searchParams.delete('new_role');
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [memberName, newRole, router]);

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
    setBannerData(null);
  };

  if (!showBanner || !bannerData) {
    return null;
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-950 dark:text-green-200">
      <CheckCircle className="size-5 shrink-0" />
      <p className="flex-1 text-sm font-medium">
        Die Rolle von <span className="font-semibold">{bannerData.memberName}</span> wurde erfolgreich zu{' '}
        <span className="font-semibold">{getRoleLabel(bannerData.newRole)}</span> geändert.
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

