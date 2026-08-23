'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  useRealtimeEvent,
  type RealtimeChangeEvent,
  type RealtimeTable,
} from '@/components/realtime/realtime-provider';
import { shouldScheduleRealtimeRefresh } from '@/lib/realtime/events';
import { useAnyDialogOpen } from '@/components/ui/open-dialog-context';

type UseRealtimeRouterRefreshOptions = {
  tables: RealtimeTable[];
  enabled?: boolean;
  debounceMs?: number;
  eventFilter?: (event: RealtimeChangeEvent) => boolean;
};

export function useRealtimeRouterRefresh({
  tables,
  enabled = true,
  debounceMs = 200,
  eventFilter,
}: UseRealtimeRouterRefreshOptions): void {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableSet = useMemo(() => new Set(tables), [tables]);

  // Dialog convention (werkflow-design skill): while any Dialog/AlertDialog/
  // Sheet is open, refreshes are suspended so they can't remount the dialog
  // mid-interaction; one catch-up refresh fires after it closes.
  const anyDialogOpen = useAnyDialogOpen();
  const anyDialogOpenRef = useRef(anyDialogOpen);
  const pendingWhileSuspendedRef = useRef(false);

  const scheduleRefresh = useCallback((event?: RealtimeChangeEvent) => {
    if (!enabled || (event && !shouldScheduleRealtimeRefresh(event, eventFilter))) {
      return;
    }

    if (anyDialogOpenRef.current) {
      pendingWhileSuspendedRef.current = true;
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      router.refresh();
    }, debounceMs);
  }, [debounceMs, enabled, eventFilter, router]);

  useEffect(() => {
    anyDialogOpenRef.current = anyDialogOpen;

    if (anyDialogOpen) {
      // Drop an already-scheduled refresh so it can't land mid-dialog.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingWhileSuspendedRef.current = true;
      }
      return;
    }

    if (pendingWhileSuspendedRef.current) {
      pendingWhileSuspendedRef.current = false;
      scheduleRefresh();
    }
  }, [anyDialogOpen, scheduleRefresh]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (enabled || !timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, [enabled]);

  useRealtimeEvent('time_entries', (event) => {
    if (tableSet.has('time_entries')) scheduleRefresh(event);
  });
  useRealtimeEvent('entry_change_requests', (event) => {
    if (tableSet.has('entry_change_requests')) scheduleRefresh(event);
  });
  useRealtimeEvent('organization_invites', (event) => {
    if (tableSet.has('organization_invites')) scheduleRefresh(event);
  });
  useRealtimeEvent('organization_members', (event) => {
    if (tableSet.has('organization_members')) scheduleRefresh(event);
  });
  useRealtimeEvent('organization_settings', (event) => {
    if (tableSet.has('organization_settings')) scheduleRefresh(event);
  });
  useRealtimeEvent('profiles', (event) => {
    if (tableSet.has('profiles')) scheduleRefresh(event);
  });
  useRealtimeEvent('employee_records', (event) => {
    if (tableSet.has('employee_records')) scheduleRefresh(event);
  });
  useRealtimeEvent('employment_conditions', (event) => {
    if (tableSet.has('employment_conditions')) scheduleRefresh(event);
  });
  useRealtimeEvent('work_schedules', (event) => {
    if (tableSet.has('work_schedules')) scheduleRefresh(event);
  });
  useRealtimeEvent('organization_closure_days', (event) => {
    if (tableSet.has('organization_closure_days')) scheduleRefresh(event);
  });
  useRealtimeEvent('vacation_requests', (event) => {
    if (tableSet.has('vacation_requests')) scheduleRefresh(event);
  });
  useRealtimeEvent('organization_responsibility_configurations', (event) => {
    if (tableSet.has('organization_responsibility_configurations')) {
      scheduleRefresh(event);
    }
  });
  useRealtimeEvent('organization_responsibility_assignments', (event) => {
    if (tableSet.has('organization_responsibility_assignments')) {
      scheduleRefresh(event);
    }
  });
  useRealtimeEvent('organization_responsibility_delegations', (event) => {
    if (tableSet.has('organization_responsibility_delegations')) {
      scheduleRefresh(event);
    }
  });
  useRealtimeEvent('clients', (event) => {
    if (tableSet.has('clients')) scheduleRefresh(event);
  });
  useRealtimeEvent('client_contacts', (event) => {
    if (tableSet.has('client_contacts')) scheduleRefresh(event);
  });
  useRealtimeEvent('client_sites', (event) => {
    if (tableSet.has('client_sites')) scheduleRefresh(event);
  });
  useRealtimeEvent('client_requests', (event) => {
    if (tableSet.has('client_requests')) scheduleRefresh(event);
  });
  useRealtimeEvent('client_follow_ups', (event) => {
    if (tableSet.has('client_follow_ups')) scheduleRefresh(event);
  });
  useRealtimeEvent('client_communication_settings', (event) => {
    if (tableSet.has('client_communication_settings')) scheduleRefresh(event);
  });
  useRealtimeEvent('client_communication_preferences', (event) => {
    if (tableSet.has('client_communication_preferences')) scheduleRefresh(event);
  });
  useRealtimeEvent('jobs', (event) => {
    if (tableSet.has('jobs')) scheduleRefresh(event);
  });
  useRealtimeEvent('projects', (event) => {
    if (tableSet.has('projects')) scheduleRefresh(event);
  });
  useRealtimeEvent('job_assignments', (event) => {
    if (tableSet.has('job_assignments')) scheduleRefresh(event);
  });
  useRealtimeEvent('planning_series', (event) => {
    if (tableSet.has('planning_series')) scheduleRefresh(event);
  });
  useRealtimeEvent('planning_occurrences', (event) => {
    if (tableSet.has('planning_occurrences')) scheduleRefresh(event);
  });
  useRealtimeEvent('planning_occurrence_assignments', (event) => {
    if (tableSet.has('planning_occurrence_assignments')) scheduleRefresh(event);
  });
  useRealtimeEvent('planning_dispatches', (event) => {
    if (tableSet.has('planning_dispatches')) scheduleRefresh(event);
  });
  useRealtimeEvent('planning_dispatch_recipients', (event) => {
    if (tableSet.has('planning_dispatch_recipients')) scheduleRefresh(event);
  });
  useRealtimeEvent('planning_dispatch_acknowledgements', (event) => {
    if (tableSet.has('planning_dispatch_acknowledgements')) scheduleRefresh(event);
  });
  useRealtimeEvent('planning_customer_commitments', (event) => {
    if (tableSet.has('planning_customer_commitments')) scheduleRefresh(event);
  });
  useRealtimeEvent('work_blockers', (event) => {
    if (tableSet.has('work_blockers')) scheduleRefresh(event);
  });
  useRealtimeEvent('work_dependencies', (event) => {
    if (tableSet.has('work_dependencies')) scheduleRefresh(event);
  });
  useRealtimeEvent('teams', (event) => {
    if (tableSet.has('teams')) scheduleRefresh(event);
  });
  useRealtimeEvent('team_memberships', (event) => {
    if (tableSet.has('team_memberships')) scheduleRefresh(event);
  });
  useRealtimeEvent('organization_capabilities', (event) => {
    if (tableSet.has('organization_capabilities')) scheduleRefresh(event);
  });
  useRealtimeEvent('employee_capabilities', (event) => {
    if (tableSet.has('employee_capabilities')) scheduleRefresh(event);
  });
  useRealtimeEvent('job_capability_requirements', (event) => {
    if (tableSet.has('job_capability_requirements')) scheduleRefresh(event);
  });
  useRealtimeEvent('job_instruction_items', (event) => {
    if (tableSet.has('job_instruction_items')) scheduleRefresh(event);
  });
  useRealtimeEvent('document_folders', (event) => {
    if (tableSet.has('document_folders')) scheduleRefresh(event);
  });
  useRealtimeEvent('documents', (event) => {
    if (tableSet.has('documents')) scheduleRefresh(event);
  });
  useRealtimeEvent('document_links', (event) => {
    if (tableSet.has('document_links')) scheduleRefresh(event);
  });
  useRealtimeEvent('document_audit_events', (event) => {
    if (tableSet.has('document_audit_events')) scheduleRefresh(event);
  });
  useRealtimeEvent('document_versions', (event) => {
    if (tableSet.has('document_versions')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_categories', (event) => {
    if (tableSet.has('inventory_categories')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_locations', (event) => {
    if (tableSet.has('inventory_locations')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_suppliers', (event) => {
    if (tableSet.has('inventory_suppliers')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_items', (event) => {
    if (tableSet.has('inventory_items')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_item_barcodes', (event) => {
    if (tableSet.has('inventory_item_barcodes')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_stock_levels', (event) => {
    if (tableSet.has('inventory_stock_levels')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_import_batches', (event) => {
    if (tableSet.has('inventory_import_batches')) scheduleRefresh(event);
  });
  useRealtimeEvent('job_material_lines', (event) => {
    if (tableSet.has('job_material_lines')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_movements', (event) => {
    if (tableSet.has('inventory_movements')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_asset_instances', (event) => {
    if (tableSet.has('inventory_asset_instances')) scheduleRefresh(event);
  });
  useRealtimeEvent('inventory_audit_events', (event) => {
    if (tableSet.has('inventory_audit_events')) scheduleRefresh(event);
  });
}
