'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle, X } from 'lucide-react';

import { getRoleLabel } from '@/lib/roles';
import type { OrgRole } from '@/lib/members/actions';

export type RoleChangeInfo = {
  firstName: string;
  lastName: string;
  newRole: OrgRole;
};

interface RoleChangeBannerProps {
  roleChangeInfo: RoleChangeInfo | null;
  onDismiss: () => void;
}

export function RoleChangeBanner({ roleChangeInfo, onDismiss }: RoleChangeBannerProps) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-dismiss banner after 3 seconds
  useEffect(() => {
    if (roleChangeInfo) {
      // Clear any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      
      timerRef.current = setTimeout(() => {
        onDismiss();
      }, 3000);
      
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
      };
    }
  }, [roleChangeInfo, onDismiss]);

  if (!roleChangeInfo) {
    return null;
  }

  // Build the display name from first and last name
  const displayName = roleChangeInfo.firstName || roleChangeInfo.lastName
    ? `${roleChangeInfo.firstName} ${roleChangeInfo.lastName}`.trim()
    : 'Mitglied';

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-950 dark:text-green-200">
      <CheckCircle className="size-5 shrink-0" />
      <p className="flex-1 text-sm font-medium">
        Die Rolle von <span className="font-semibold">{displayName}</span> wurde erfolgreich zu{' '}
        <span className="font-semibold">{getRoleLabel(roleChangeInfo.newRole)}</span> geändert.
      </p>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded-md p-1 hover:bg-green-100 dark:hover:bg-green-900 transition-colors"
        aria-label="Banner schließen"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

