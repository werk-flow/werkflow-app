'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  useRealtimeEvent,
  type RealtimeTable,
} from '@/components/realtime/realtime-provider';

type UseRealtimeRouterRefreshOptions = {
  tables: RealtimeTable[];
  enabled?: boolean;
  debounceMs?: number;
};

export function useRealtimeRouterRefresh({
  tables,
  enabled = true,
  debounceMs = 200,
}: UseRealtimeRouterRefreshOptions) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableSet = useMemo(() => new Set(tables), [tables]);

  const scheduleRefresh = useCallback(() => {
    if (!enabled) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      router.refresh();
    }, debounceMs);
  }, [debounceMs, enabled, router]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useRealtimeEvent('time_entries', () => {
    if (tableSet.has('time_entries')) scheduleRefresh();
  });
  useRealtimeEvent('entry_change_requests', () => {
    if (tableSet.has('entry_change_requests')) scheduleRefresh();
  });
  useRealtimeEvent('organization_invites', () => {
    if (tableSet.has('organization_invites')) scheduleRefresh();
  });
  useRealtimeEvent('organization_members', () => {
    if (tableSet.has('organization_members')) scheduleRefresh();
  });
  useRealtimeEvent('organization_settings', () => {
    if (tableSet.has('organization_settings')) scheduleRefresh();
  });
  useRealtimeEvent('profiles', () => {
    if (tableSet.has('profiles')) scheduleRefresh();
  });
  useRealtimeEvent('clients', () => {
    if (tableSet.has('clients')) scheduleRefresh();
  });
  useRealtimeEvent('jobs', () => {
    if (tableSet.has('jobs')) scheduleRefresh();
  });
  useRealtimeEvent('projects', () => {
    if (tableSet.has('projects')) scheduleRefresh();
  });
  useRealtimeEvent('job_assignments', () => {
    if (tableSet.has('job_assignments')) scheduleRefresh();
  });
  useRealtimeEvent('job_instruction_items', () => {
    if (tableSet.has('job_instruction_items')) scheduleRefresh();
  });
  useRealtimeEvent('document_folders', () => {
    if (tableSet.has('document_folders')) scheduleRefresh();
  });
  useRealtimeEvent('documents', () => {
    if (tableSet.has('documents')) scheduleRefresh();
  });
  useRealtimeEvent('document_links', () => {
    if (tableSet.has('document_links')) scheduleRefresh();
  });
  useRealtimeEvent('document_audit_events', () => {
    if (tableSet.has('document_audit_events')) scheduleRefresh();
  });
  useRealtimeEvent('document_versions', () => {
    if (tableSet.has('document_versions')) scheduleRefresh();
  });
}
