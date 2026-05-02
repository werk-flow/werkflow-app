'use client';

import Link from 'next/link';
import { Users, Clock, AlertCircle } from 'lucide-react';
import { usePendingApprovalCount } from '@/components/realtime/pending-approval-count-provider';

interface QuickStatsProps {
  organizationId: string;
  totalMembers: number;
  /** Active working count - passed from parent that has statusMap */
  activeWorkingCount: number;
  /** Whether the current user is an admin */
  isAdmin?: boolean;
}

export function QuickStats({
  organizationId: _organizationId,
  totalMembers,
  activeWorkingCount,
  isAdmin: _isAdmin = false
}: QuickStatsProps) {
  const { pendingApprovalCount } = usePendingApprovalCount();
  const pendingCount = pendingApprovalCount;

  return (
    <div className="flex flex-wrap gap-4 mb-4">
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">
          <span className="font-medium">{totalMembers}</span>
          <span className="text-muted-foreground ml-1">Mitglieder</span>
        </span>
      </div>

      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <Clock className="h-4 w-4 text-green-500" />
        <span className="text-sm">
          <span className="font-medium">{activeWorkingCount}</span>
          <span className="text-muted-foreground ml-1">
            {activeWorkingCount === 1 ? 'arbeitet gerade' : 'arbeiten gerade'}
          </span>
        </span>
      </div>

      {pendingCount > 0 && (
        <Link
          href="/zeiterfassung?tab=approvals"
          className="flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 transition-colors hover:bg-yellow-100 dark:hover:bg-yellow-950/40"
        >
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <span className="text-sm">
            <span className="font-medium text-yellow-700 dark:text-yellow-400">
              {pendingCount}
            </span>
            <span className="text-yellow-600 dark:text-yellow-500 ml-1">
              {pendingCount === 1
                ? 'ausstehender Antrag'
                : 'ausstehende Anträge'}
            </span>
          </span>
        </Link>
      )}
    </div>
  );
}
