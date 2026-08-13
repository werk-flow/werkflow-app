'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode
} from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload
} from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useOrganization } from '@/components/organization/organization-context';
import { coalesceRealtimeEvents } from '@/lib/realtime/events';

export type RealtimeTable =
  | 'time_entries'
  | 'entry_change_requests'
  | 'organization_invites'
  | 'organization_members'
  | 'organization_settings'
  | 'profiles'
  | 'employee_records'
  | 'employment_conditions'
  | 'work_schedules'
  | 'organization_closure_days'
  | 'vacation_requests'
  | 'sickness_reports'
  | 'teams'
  | 'team_memberships'
  | 'organization_capabilities'
  | 'employee_capabilities'
  | 'organization_qualification_settings'
  | 'job_capability_requirements'
  | 'attention_read_states'
  | 'attention_events'
  | 'organization_responsibility_configurations'
  | 'organization_responsibility_assignments'
  | 'organization_responsibility_delegations'
  | 'clients'
  | 'client_contacts'
  | 'client_sites'
  | 'client_requests'
  | 'client_follow_ups'
  | 'client_communication_settings'
  | 'client_communication_preferences'
  | 'jobs'
  | 'projects'
  | 'job_assignments'
  | 'planning_series'
  | 'planning_occurrences'
  | 'planning_occurrence_assignments'
  | 'job_instruction_items'
  | 'document_folders'
  | 'documents'
  | 'document_links'
  | 'document_audit_events'
  | 'document_versions'
  | 'inventory_categories'
  | 'inventory_locations'
  | 'inventory_suppliers'
  | 'inventory_items'
  | 'inventory_item_barcodes'
  | 'inventory_stock_levels'
  | 'inventory_import_batches'
  | 'job_material_lines'
  | 'inventory_movements'
  | 'inventory_asset_instances'
  | 'inventory_audit_events';

export type RealtimeChangeEvent = {
  table: RealtimeTable;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

type RealtimeCallback = (event: RealtimeChangeEvent) => void;

type RealtimeContextValue = {
  subscribe: (table: RealtimeTable, cb: RealtimeCallback) => () => void;
};

const TABLES: RealtimeTable[] = [
  'time_entries',
  'entry_change_requests',
  'organization_invites',
  'organization_members',
  'organization_settings',
  'profiles',
  'employee_records',
  'employment_conditions',
  'work_schedules',
  'organization_closure_days',
  'vacation_requests',
  'sickness_reports',
  'teams',
  'team_memberships',
  'organization_capabilities',
  'employee_capabilities',
  'organization_qualification_settings',
  'job_capability_requirements',
  'attention_read_states',
  'attention_events',
  'organization_responsibility_configurations',
  'organization_responsibility_assignments',
  'organization_responsibility_delegations',
  'clients',
  'client_contacts',
  'client_sites',
  'client_requests',
  'client_follow_ups',
  'client_communication_settings',
  'client_communication_preferences',
  'jobs',
  'projects',
  'job_assignments',
  'planning_series',
  'planning_occurrences',
  'planning_occurrence_assignments',
  'job_instruction_items',
  'document_folders',
  'documents',
  'document_links',
  'document_audit_events',
  'document_versions',
  'inventory_categories',
  'inventory_locations',
  'inventory_suppliers',
  'inventory_items',
  'inventory_item_barcodes',
  'inventory_stock_levels',
  'inventory_import_batches',
  'job_material_lines',
  'inventory_movements',
  'inventory_asset_instances',
  'inventory_audit_events'
];

const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const isDev = process.env.NODE_ENV === 'development';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useOrganization();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const listenersRef = useRef<Map<RealtimeTable, Set<RealtimeCallback>>>(
    new Map(TABLES.map((t) => [t, new Set<RealtimeCallback>()]))
  );

  const debounceTimersRef = useRef<Map<RealtimeTable, NodeJS.Timeout>>(new Map());
  const pendingEventsRef = useRef<Map<RealtimeTable, RealtimeChangeEvent>>(new Map());

  const dispatchAll = useCallback(() => {
    for (const table of TABLES) {
      const listeners = listenersRef.current.get(table);
      if (!listeners || listeners.size === 0) continue;
      const syntheticEvent: RealtimeChangeEvent = {
        table,
        eventType: 'UPDATE',
        new: null,
        old: null,
      };
      listeners.forEach((cb) => cb(syntheticEvent));
    }
  }, []);

  useEffect(() => {
    if (!activeOrgId) return;

    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    function dispatch(
      table: RealtimeTable,
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) {
      const listeners = listenersRef.current.get(table);
      const count = listeners?.size ?? 0;
      if (count === 0) return;

      const event: RealtimeChangeEvent = {
        table,
        eventType: payload.eventType as RealtimeChangeEvent['eventType'],
        new: (payload.new as Record<string, unknown>) ?? null,
        old: (payload.old as Record<string, unknown>) ?? null
      };

      if (isDev) {
        console.info('[Realtime] event received', {
          channel: `org-${activeOrgId}`,
          table,
          eventType: event.eventType
        });
      }

      // Debounce: coalesce rapid-fire events on the same table into a single dispatch.
      // This prevents the thundering herd when e.g. switchJob inserts 2 time_entries
      // in quick succession, which would otherwise trigger 10+ parallel refetches twice.
      const existing = debounceTimersRef.current.get(table);
      if (existing) clearTimeout(existing);
      pendingEventsRef.current.set(
        table,
        coalesceRealtimeEvents(pendingEventsRef.current.get(table), event)
      );

      debounceTimersRef.current.set(
        table,
        setTimeout(() => {
          debounceTimersRef.current.delete(table);
          const pendingEvent = pendingEventsRef.current.get(table);
          pendingEventsRef.current.delete(table);
          if (pendingEvent) listeners!.forEach((cb) => cb(pendingEvent));
        }, 150)
      );
    }

    async function setup() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }

      const channel = supabase
        .channel(`org-${activeOrgId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'time_entries',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('time_entries', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'entry_change_requests',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('entry_change_requests', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_invites',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_invites', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_members',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_members', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_settings',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_settings', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'profiles'
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('profiles', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'employee_records',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('employee_records', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'employment_conditions',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('employment_conditions', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_schedules',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('work_schedules', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_closure_days',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_closure_days', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'vacation_requests',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('vacation_requests', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'sickness_reports',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('sickness_reports', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'teams',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('teams', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'team_memberships',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('team_memberships', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_capabilities',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_capabilities', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'employee_capabilities',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('employee_capabilities', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_qualification_settings',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_qualification_settings', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'job_capability_requirements',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('job_capability_requirements', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_responsibility_configurations',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_responsibility_configurations', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_responsibility_assignments',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_responsibility_assignments', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_responsibility_delegations',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_responsibility_delegations', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'clients',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('clients', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'client_contacts',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('client_contacts', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'client_sites',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('client_sites', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'client_requests',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('client_requests', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'client_follow_ups',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('client_follow_ups', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'client_communication_settings',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('client_communication_settings', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'client_communication_preferences',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('client_communication_preferences', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'jobs',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('jobs', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'projects',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('projects', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'job_assignments'
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            // job_assignments has no organization_id column, so we can't filter server-side.
            // Consumers should be resilient to stale events; debouncing limits the impact.
            dispatch('job_assignments', p);
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'job_instruction_items',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('job_instruction_items', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'planning_series',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('planning_series', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'planning_occurrences',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('planning_occurrences', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'planning_occurrence_assignments',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('planning_occurrence_assignments', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'document_folders',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('document_folders', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'documents',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('documents', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'document_links',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('document_links', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'document_audit_events',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('document_audit_events', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'document_versions',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('document_versions', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_categories',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_categories', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_locations',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_locations', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_suppliers',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_suppliers', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_items',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_items', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_item_barcodes',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_item_barcodes', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_stock_levels',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_stock_levels', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_import_batches',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_import_batches', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'job_material_lines',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('job_material_lines', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_movements',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_movements', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_asset_instances',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_asset_instances', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_audit_events',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('inventory_audit_events', p)
        )
        .subscribe((status: string, err?: Error) => {
          if (isDev) {
            console.info('[Realtime] channel status', {
              channel: `org-${activeOrgId}`,
              status
            });
          }
          if (err) {
            console.error('[Realtime] subscription error:', err);
          }
          if (status === 'SUBSCRIBED') {
            console.info(`[Realtime] subscribed to org-${activeOrgId}`);
          }
          if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
            console.warn(`[Realtime] ${status} — will reconnect automatically`);
          }
        });

      channelRef.current = channel;
    }

    setup();

    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange(
      (_event: string, session: { access_token?: string } | null) => {
        if (session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      }
    );

    // Refresh all listeners when the tab becomes visible again.
    // Browsers (especially Edge) may throttle or drop WebSocket connections
    // for background tabs; this ensures data is fresh when the user returns.
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        dispatchAll();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const debounceTimers = debounceTimersRef.current;
    const pendingEvents = pendingEventsRef.current;

    return () => {
      cancelled = true;
      authListener.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      pendingEvents.clear();
    };
  }, [activeOrgId, dispatchAll]);

  const subscribe = useCallback((table: RealtimeTable, cb: RealtimeCallback) => {
    listenersRef.current.get(table)?.add(cb);
    return () => {
      listenersRef.current.get(table)?.delete(cb);
    };
  }, []);

  const ctxValue = useMemo<RealtimeContextValue>(
    () => ({ subscribe }),
    [subscribe]
  );

  return (
    <RealtimeContext.Provider value={ctxValue}>
      {children}
    </RealtimeContext.Provider>
  );
}

/**
 * Subscribe to Realtime changes on a specific table.
 * The callback fires whenever a row in that table (for the active org) is inserted, updated, or deleted.
 */
export function useRealtimeEvent(
  table: RealtimeTable,
  callback: RealtimeCallback
) {
  const ctx = useContext(RealtimeContext);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!ctx) return;

    const stableCallback: RealtimeCallback = (event) => {
      callbackRef.current(event);
    };

    return ctx.subscribe(table, stableCallback);
  }, [ctx, table]);
}

