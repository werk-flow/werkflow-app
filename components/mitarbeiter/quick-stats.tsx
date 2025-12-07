'use client';

import { useState, useEffect } from 'react';
import { Users, Clock, AlertCircle } from 'lucide-react';
import {
  getCurrentlyClockedIn,
  getPendingSessions
} from '@/lib/time-tracking/actions';

interface QuickStatsProps {
  organizationId: string;
  totalMembers: number;
}

export function QuickStats({ organizationId, totalMembers }: QuickStatsProps) {
  const [activeCount, setActiveCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      const [activeResult, pendingResult] = await Promise.all([
        getCurrentlyClockedIn(organizationId),
        getPendingSessions(organizationId)
      ]);

      if (activeResult.success) {
        setActiveCount(activeResult.users.length);
      }
      if (pendingResult.success) {
        // Use sessions count - pairs are counted as 1 session
        setPendingCount(pendingResult.sessions.length);
      }
    };

    fetchStats();
    // Poll every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [organizationId]);

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
          <span className="font-medium">{activeCount}</span>
          <span className="text-muted-foreground ml-1">arbeiten gerade</span>
        </span>
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2">
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
        </div>
      )}
    </div>
  );
}
