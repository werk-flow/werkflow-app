"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { calendarActionResult } from "@/lib/calendar/action-result";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Briefcase, Undo2 } from "lucide-react";
import { CalendarHeader } from "./calendar-header";
import { CalendarViewTabs } from "./calendar-view-tabs";
import { DayView } from "./day-view/day-view";
import { WeekView } from "./week-view/week-view";
import { DayViewSkeleton } from "./day-view/day-view-skeleton";
import { WeekViewSkeleton } from "./week-view/week-view-skeleton";
import { FullCalendarSkeleton } from "./fullcalendar-skeleton";
import {
  reassignEntries as reassignEntriesAction,
  reassignEntryBatch as reassignEntryBatchAction,
} from "@/lib/time-tracking/actions";
import {
  getParkedJobs,
  updateJob as updateJobAction,
  type UpdateJobInput,
} from "@/lib/jobs/actions";
import { parkWorkTarget, unparkWorkTarget } from "@/lib/work-lifecycle/actions";
import {
  updatePlanningCalendarEntry,
  type UpdatePlanningCalendarInput,
} from "@/lib/planning/actions";
import { useQualificationWarningConfirmation } from "@/components/auftraege/qualification-warning-dialog";
import { useLiveView } from "@/hooks/use-live-view";
import { useRealtimeRouterRefresh } from "@/hooks/use-realtime-router-refresh";
import type { CalendarJob } from "@/lib/jobs/types";
import { ParkplatzPanel } from "./parkplatz-panel";
import { DispatchPanel } from "./dispatch-panel";
import { DispatchIssueDialog } from "./dispatch-issue-dialog";
import { ParkingContextDialog } from "./parking-context-dialog";
import { getJobParkingContexts } from "@/lib/parking/actions";
import type { JobParkingContext } from "@/lib/parking/types";
import { clearCalendarDragState } from "./drag-state";
import { useBanner } from "@/components/ui/banner";
import { SectionError } from "@/components/ui/section-error";
import { cn } from "@/lib/utils";
import { PageBody, PageShell } from "@/components/shared/page-shell";
import { usePlanningWarningConfirmation } from "./planning-warning-dialog";
import {
  useCalendarRangeData,
  type CalendarDataset,
  type CalendarInitialData,
} from "./use-calendar-range-data";

const EntryDetailsDialog = dynamic(
  () => import("./entry-details-dialog").then((mod) => mod.EntryDetailsDialog),
  { ssr: false },
);
import type {
  InteractiveCalendarSession,
  TimeEntry,
  WorkSession,
} from "@/lib/time-tracking/types";
import type { OrgRole } from "@/lib/members/actions";
import {
  consumeManualEntryBridge,
  MANUAL_ENTRY_CREATED_EVENT,
} from "@/lib/time-tracking/manual-entry-bridge";
import type { OrganizationTimeTrackingSettings } from "@/lib/time-tracking/settings";
import type { OrganizationHolidayCalendar } from "@/lib/personnel/targets";
import { toLocalDateString } from "@/lib/utils";
import {
  getCalendarFetchRange,
  shiftCalendarDate,
} from "@/lib/calendar/navigation";

const reassignEntries = (...args: Parameters<typeof reassignEntriesAction>) => calendarActionResult(() => reassignEntriesAction(...args));
const reassignEntryBatch = (...args: Parameters<typeof reassignEntryBatchAction>) => calendarActionResult(() => reassignEntryBatchAction(...args));

export type CalendarView = "day" | "week" | "month";

// Only the month grid renders absences; day and week gate readiness on the
// two datasets they draw, so a failed absence read cannot block them.
const REQUIRED_DATASETS: Record<CalendarView, readonly CalendarDataset[]> = {
  day: ["entries", "jobs"],
  week: ["entries", "jobs"],
  month: ["entries", "jobs", "vacation", "sickness", "holidays"],
};

// Filters for what types of events to show in the calendar
export interface CalendarFilters {
  showWorkingHours: boolean;
  showJobs: boolean;
}

// Dynamically import FullCalendar to avoid SSR issues
const FullCalendarView = dynamic(
  () => import("./fullcalendar-view").then((mod) => mod.FullCalendarView),
  {
    ssr: false,
    loading: () => <FullCalendarSkeleton view="month" />,
  },
);

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface CalendarContainerProps {
  organizationId: string;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  members: CalendarMember[];
  organizationSettings: OrganizationTimeTrackingSettings;
  /** Holiday/closure context (P1-04), shown in the FullCalendar month view. */
  holidayCalendar?: OrganizationHolidayCalendar;
  /** Server-rendered day window with the exact range it was read for (PF-17). */
  initialData?: CalendarInitialData;
  initialDate?: string;
}

// Every calendar read keeps its last-known data on failure and says so through
// one persistent error banner; a later failure replaces it, so the fan-out of a
// manual refresh never stacks alerts.
const CALENDAR_READ_FAILED_MESSAGE =
  "Der Kalender konnte nicht aktualisiert werden. Angezeigt wird der letzte bekannte Stand.";

function sortEntriesByTimestamp(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    const timestampDiff =
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (timestampDiff !== 0) return timestampDiff;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function CalendarContainer(props: CalendarContainerProps): React.JSX.Element {
  return <ScopedCalendarContainer key={`${props.organizationId}:${props.currentUserId}:${props.currentUserRole}:${props.initialDate ?? ""}`} {...props} />;
}

function ScopedCalendarContainer({
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  members,
  organizationSettings,
  holidayCalendar,
  initialData,
  initialDate,
}: CalendarContainerProps) {
  const scopeActive = useRef(true);
  useEffect(() => { scopeActive.current = true; return () => { scopeActive.current = false; }; }, []);
  const isScopeActive = useCallback(() => scopeActive.current, []);
  const pathname = usePathname();
  const { requestApproval, warningDialog } =
    useQualificationWarningConfirmation();
  const {
    requestApproval: requestPlanningApproval,
    warningDialog: planningWarningDialog,
  } = usePlanningWarningConfirmation();
  const updateJob = useCallback(
    async (jobId: string, input: UpdateJobInput) => calendarActionResult(async () => {
      if (!scopeActive.current) return { success: false as const, error: "calendar_scope_changed" };
      const planningEntry = calendarJobsRef.current.find(
        (entry) => entry.id === jobId && entry.occurrenceId,
      );
      if (planningEntry) {
        const planningInput: UpdatePlanningCalendarInput = {
          ...(input.plannedDate ? { plannedDate: input.plannedDate } : {}),
          ...(input.plannedTime ? { plannedTime: input.plannedTime } : {}),
          ...(input.estimatedDurationMinutes !== undefined
            ? { estimatedDurationMinutes: input.estimatedDurationMinutes }
            : {}),
          ...(input.selectedUserIds !== undefined
            ? { selectedUserIds: input.selectedUserIds }
            : {}),
        };
        let result = await updatePlanningCalendarEntry(
          planningEntry.occurrenceId!,
          planningInput,
        );
        if (
          !result.success &&
          (result.error === "planning_warning" ||
            result.error === "stale_assessment") &&
          "conflicts" in result &&
          result.conflicts &&
          result.fingerprint
        ) {
          // The approval dialog registers with the shared open-dialog
          // context, so Realtime reads stay suspended while it blocks on
          // human input and the mutation ownership below covers the retry.
          const approval = await requestPlanningApproval(
            result.conflicts,
            result.fingerprint,
          );
          if (!approval || !scopeActive.current) {
            return { success: false as const, error: "qualification_declined" };
          }
          result = await updatePlanningCalendarEntry(
            planningEntry.occurrenceId!,
            {
              ...planningInput,
              overrideReason: approval.reason,
              assessmentFingerprint: approval.fingerprint,
            },
          );
        }
        return result;
      }
      let result = await updateJobAction(jobId, input);
      if (
        !result.success &&
        (result.error === "qualification_warning" ||
          result.error === "stale_evaluation") &&
        "evaluation" in result
      ) {
        const approval = await requestApproval(result.evaluation);
        if (!approval || !scopeActive.current) {
          return {
            success: false as const,
            error: "qualification_declined" as const,
          };
        }
        if (approval) {
          result = await updateJobAction(jobId, {
            ...input,
            assignmentApproval: approval,
          });
        }
      }
      return result;
    }),
    [requestApproval, requestPlanningApproval],
  );
  const [currentDate, setCurrentDate] = useState(() => initialDate ? new Date(`${initialDate}T12:00:00`) : new Date());
  const [view, setView] = useState<CalendarView>("day");
  const { showBanner } = useBanner();
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    members.map((m) => m.user_id),
  );
  const [selectedSession, setSelectedSession] =
    useState<InteractiveCalendarSession | null>(null);
  // The read window follows the selected date and view (PF-01); the data
  // owner below tracks which datasets cover it.
  const needed = useMemo(
    () => getCalendarFetchRange(currentDate, view),
    [currentDate, view],
  );
  const requiredDatasets = REQUIRED_DATASETS[view];
  const reportReadFailure = useCallback(
    () => showBanner({ variant: "error", message: CALENDAR_READ_FAILED_MESSAGE }),
    [showBanner],
  );
  const [parkedJobs, setParkedJobs] = useState<CalendarJob[]>([]);
  const [parkplatzOpen, setParkplatzOpen] = useState(false);
  // P1-12: dispatch panel, Parkplatz context, and parked-job dispatch state.
  const [dispatchPanelOpen, setDispatchPanelOpen] = useState(false);
  // null until the first successful load so the panel can distinguish
  // "still loading" from "loaded, no context recorded".
  const [parkingContexts, setParkingContexts] = useState<Map<
    string,
    JobParkingContext
  > | null>(null);
  // Written together with the state: the undo of a park unparks right after
  // an awaited context fetch, before React has re-rendered with the new map.
  const parkingContextsRef = useRef<Map<string, JobParkingContext> | null>(
    null,
  );
  const [parkingContextJob, setParkingContextJob] =
    useState<CalendarJob | null>(null);
  const [parkedDispatchJob, setParkedDispatchJob] =
    useState<CalendarJob | null>(null);
  const [filters, setFilters] = useState<CalendarFilters>({
    showWorkingHours: false,
    showJobs: true,
  });

  const parkplatzButtonRef = useRef<HTMLButtonElement>(null);
  const calendarHeaderRef = useRef<HTMLDivElement>(null);
  const [calendarHeaderHeight, setCalendarHeaderHeight] = useState(76);

  // Tracks the currently-dragged parkplatz job (for day view visual indicators)
  const [parkplatzDragJob, setParkplatzDragJob] = useState<CalendarJob | null>(
    null,
  );
  // Cursor position during parkplatz drag (for floating preview)
  const [parkplatzDragCursor, setParkplatzDragCursor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // Whether the cursor is over the parkplatz panel/button during drag
  const [cursorOverParkplatz, setCursorOverParkplatz] = useState(false);
  // Tracks whether a FullCalendar drag is hovering over the parkplatz area
  const [fcDragOverParkplatz, setFcDragOverParkplatz] = useState(false);

  // Track cursor position during parkplatz drag for the floating preview
  useEffect(() => {
    if (!parkplatzDragJob) {
      setParkplatzDragCursor(null);
      setCursorOverParkplatz(false);
      return;
    }

    const handler = (e: DragEvent) => {
      if (e.clientX === 0 && e.clientY === 0) return;
      setParkplatzDragCursor({ x: e.clientX, y: e.clientY });

      let overParkplatz = false;
      const panel = document.querySelector("[data-parkplatz-panel]");
      if (panel) {
        const rect = panel.getBoundingClientRect();
        overParkplatz =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
      }
      if (!overParkplatz) {
        const btn = parkplatzButtonRef.current;
        if (btn) {
          const rect = btn.getBoundingClientRect();
          overParkplatz =
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom;
        }
      }
      setCursorOverParkplatz(overParkplatz);
    };

    const endHandler = () => {
      clearCalendarDragState();
    };

    window.addEventListener("dragover", handler);
    window.addEventListener("dragend", endHandler);
    return () => {
      window.removeEventListener("dragover", handler);
      window.removeEventListener("dragend", endHandler);
    };
  }, [parkplatzDragJob]);

  useEffect(() => {
    const headerEl = calendarHeaderRef.current;
    if (!headerEl) return;

    const updateHeights = () => {
      setCalendarHeaderHeight(headerEl.getBoundingClientRect().height);
    };

    updateHeights();

    const observer = new ResizeObserver(updateHeights);
    observer.observe(headerEl);
    window.addEventListener("resize", updateHeights);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeights);
    };
  }, []);

  // Refs that always hold the latest state. DnD handlers read from these
  // instead of closing over stale values during rapid successive actions.
  const calendarJobsRef = useRef<CalendarJob[]>([]);
  const entriesRef = useRef<TimeEntry[]>([]);
  const parkedJobsRef = useRef(parkedJobs);

  const parkedJobsRequestIdRef = useRef(0);
  const parkedJobsLoadedRef = useRef(false);
  const previousMemberIdsRef = useRef(
    new Set(members.map((member) => member.user_id)),
  );

  // Track which member to highlight when navigating from week view cell click
  // We use two states: pendingHighlight stores the ID while loading,
  // highlightMemberId is the active highlight (only set after loading completes)
  const [pendingHighlightMemberId, setPendingHighlightMemberId] = useState<
    string | null
  >(null);
  const [highlightMemberId, setHighlightMemberId] = useState<string | null>(
    null,
  );

  // Parked jobs are not range-scoped; they ride the planning invalidation
  // set through `readPlanningExtras` and keep their own generation guard.
  const fetchParkedJobs = useCallback(async (): Promise<boolean> => {
    if (!scopeActive.current || !isAdminOrManager) return false;
    const requestId = ++parkedJobsRequestIdRef.current;
    const result = await getParkedJobs().catch((error: unknown) => {
      console.error("Error fetching parked jobs:", error);
      return { success: false as const };
    });
    if (!scopeActive.current || parkedJobsRequestIdRef.current !== requestId) return false;
    if (!result.success) {
      reportReadFailure();
      return false;
    }
    setParkedJobs(result.jobs);
    parkedJobsLoadedRef.current = true;
    return true;
  }, [reportReadFailure, isAdminOrManager]);

  const readPlanningExtras = useCallback(
    async () => (isAdminOrManager ? fetchParkedJobs() : true),
    [isAdminOrManager, fetchParkedJobs],
  );

  const {
    entries,
    jobs: calendarJobs,
    vacation: vacationEntries,
    sickness: sicknessEntries,
    holidays: liveHolidayCalendar,
    changeRequestMap,
    readiness,
    updateEntries: setEntries,
    updateJobs: setCalendarJobs,
    beginMutation,
    refreshAll,
  } = useCalendarRangeData({
    organizationId,
    identityKey: `${currentUserId}:${currentUserRole}`,
    needed,
    requiredDatasets,
    initial: initialData ? { ...initialData, holidays: holidayCalendar } : undefined,
    onReadFailed: reportReadFailure,
    readPlanningExtras,
  });
  // The skeleton replaces the grid only while no data exists at all (first
  // open, organization switch). Navigating to an uncovered window keeps the
  // grid mounted and marks it busy; unmounting it on every month step broke
  // the golden month navigation (verification 2026-09-08T123622581Z).
  const isLoading = readiness.kind === "loading" && !readiness.hasData;
  const isReloading = readiness.kind === "loading" && readiness.hasData;

  useEffect(() => {
    // These refs are the intentional escape hatch for DnD handlers that must
    // read the latest optimistic state after an awaited confirmation dialog.
    calendarJobsRef.current = calendarJobs;
    entriesRef.current = entries;
    parkedJobsRef.current = parkedJobs;
  }, [calendarJobs, entries, parkedJobs]);

  useEffect(() => {
    const previousMemberIds = previousMemberIdsRef.current;
    const memberIds = members.map((member) => member.user_id);
    const memberIdSet = new Set(memberIds);

    setSelectedMembers((current) => {
      const next = current.filter((memberId) => memberIdSet.has(memberId));
      for (const memberId of memberIds) {
        if (!previousMemberIds.has(memberId) && !next.includes(memberId)) {
          next.push(memberId);
        }
      }

      if (
        next.length === current.length &&
        next.every((memberId, index) => memberId === current[index])
      ) {
        return current;
      }

      return next;
    });

    previousMemberIdsRef.current = memberIdSet;
  }, [members]);

  // Keep parked jobs loaded for admins so the header count and panel stay fresh.
  useEffect(() => {
    if (isAdminOrManager && !parkedJobsLoadedRef.current) {
      void fetchParkedJobs();
    }
  }, [isAdminOrManager, fetchParkedJobs]);

  // P1-12: Parkplatz context (reason/responsible/next review) for managers.
  const parkingContextsRequestIdRef = useRef(0);
  const fetchParkingContexts = useCallback(async (): Promise<boolean> => {
    const requestId = ++parkingContextsRequestIdRef.current;
    if (!scopeActive.current || !isAdminOrManager) return false;
    const result = await getJobParkingContexts().catch((error: unknown) => {
      console.error("Failed to refresh parking contexts:", error);
      return { success: false as const };
    });
    // Generation guard: an older response (or one from a previous
    // organization) must never overwrite newer state.
    if (!scopeActive.current || parkingContextsRequestIdRef.current !== requestId) return false;
    // Keep last-known contexts on failure; the panel keeps its labeled
    // missing-context state otherwise.
    if (!result.success) {
      reportReadFailure();
      return false;
    }
    const next = new Map(
      result.contexts.map((context) => [context.jobId, context]),
    );
    parkingContextsRef.current = next;
    setParkingContexts(next);
    return true;
  }, [isAdminOrManager, reportReadFailure]);
  useEffect(() => {
    void fetchParkingContexts();
  }, [fetchParkingContexts, organizationId]);

  // Server props (members and time settings) reload
  // through the route; the shared dialog suspension covers open editors.
  useRealtimeRouterRefresh({
    tables: [
      "organization_members",
      "profiles",
      "organization_settings",
    ],
  });
  useLiveView<null>({
    tables: ["work_blockers"],
    read: async () => {
      const ok = await fetchParkingContexts();
      return ok ? { ok: true, data: null } : { ok: false };
    },
    initialData: null,
    enabled: isAdminOrManager,
    eventFilter: (event) => {
      const kind = (event.new ?? event.old)?.kind;
      return kind == null || kind === "parking";
    },
  });

  // Manual refresh: existing content stays on screen while the header's
  // RefreshButton spins on the awaited promise; only an uncovered range shows
  // the skeleton (feedback canon).
  const handleManualRefresh = useCallback(async () => {
    await Promise.all([refreshAll(), fetchParkingContexts()]);
  }, [refreshAll, fetchParkingContexts]);

  // Every optimistic mutation takes ownership of the calendar data until its
  // server call (or undo) settles; the last settlement schedules the one
  // authoritative read (PF-04).
  const handleOperationStart = useCallback(() => {
    parkedJobsRequestIdRef.current += 1;
    return beginMutation();
  }, [beginMutation]);
  const handleSilentRefresh = useCallback(() => { void refreshAll(); }, [refreshAll]);

  // Adapter over the global banner (feedback canon): parkplatz/drag successes
  // carry Undo only after persistence; errors persist until dismissed.
  // Each operation releases its own lease in finally, including a failed Undo.
  const showParkplatzBanner = useCallback(
    (banner: {
      variant: "success" | "error";
      message: string;
      onUndo?: (() => Promise<void>) | undefined;
    }) => {
      if (!scopeActive.current) return;
      showBanner({
        variant: banner.variant,
        message: banner.message,
        ...(banner.variant === "success" && banner.onUndo
          ? {
              actionLabel: "Rückgängig",
              actionIcon: <Undo2 className="size-3.5" />,
              onAction: () => {
                if (!scopeActive.current) return;
                void banner.onUndo?.().catch(() => {
                  handleSilentRefresh();
                  showBanner({
                    variant: "error",
                    message:
                      "Die Aktion konnte nicht rückgängig gemacht werden.",
                  });
                });
              },
            }
          : {}),
      });
    },
    [showBanner, handleSilentRefresh],
  );
  // Undo handlers run only after the forward call settled (the banner appears
  // after persistence), so a returned failure is their one remaining silent
  // path; thrown failures are caught by the adapter above.
  const reportUndoResult = useCallback(
    (result: { success: boolean; error?: string }) => {
      if (result.success || result.error === "qualification_declined") return;
      showBanner({
        variant: "error",
        message: "Die Aktion konnte nicht rückgängig gemacht werden.",
      });
    },
    [showBanner],
  );

  const handleManualEntrySuccess = useCallback(
    (newEntries: TimeEntry[]) => {
      const releaseOperation = handleOperationStart();
      try {
        const visibleNewEntries = newEntries.filter((entry) => {
          const timestamp = new Date(entry.timestamp).getTime();
          return (
            timestamp >= needed.start.getTime() &&
            timestamp <= needed.end.getTime()
          );
        });

        if (visibleNewEntries.length > 0) {
          setEntries((prev) => {
            const merged = new Map(prev.map((entry) => [entry.id, entry]));
            for (const entry of visibleNewEntries) {
              merged.set(entry.id, entry);
            }
            return sortEntriesByTimestamp(Array.from(merged.values()));
          });
        }

      } finally {
        releaseOperation();
      }
    },
    [needed, handleOperationStart, setEntries],
  );

  useEffect(() => {
    const handleExternalManualEntry = (event: Event) => {
      const customEvent = event as CustomEvent<{ entries?: TimeEntry[] }>;
      const newEntries = customEvent.detail?.entries;
      if (!newEntries?.length) return;
      if (newEntries.every((entry) => entry.organizationId !== organizationId))
        return;
      handleManualEntrySuccess(newEntries);
    };

    window.addEventListener(
      MANUAL_ENTRY_CREATED_EVENT,
      handleExternalManualEntry as EventListener,
    );
    return () => {
      window.removeEventListener(
        MANUAL_ENTRY_CREATED_EVENT,
        handleExternalManualEntry as EventListener,
      );
    };
  }, [handleManualEntrySuccess, organizationId]);

  useEffect(() => {
    if (pathname !== "/kalender") return;

    const queuedEntries = consumeManualEntryBridge(organizationId);
    if (queuedEntries.length > 0) {
      handleManualEntrySuccess(queuedEntries);
    }
  }, [handleManualEntrySuccess, organizationId, pathname]);

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    setCurrentDate((previousDate) => shiftCalendarDate(previousDate, view, -1));
  }, [view]);

  const handleNext = useCallback(() => {
    setCurrentDate((previousDate) => shiftCalendarDate(previousDate, view, 1));
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const handleDateSelect = useCallback((date: Date) => {
    setCurrentDate(date);
    // Clear any pending/active highlight when navigating via date selection
    // (e.g., clicking day header in week view - no specific member)
    setPendingHighlightMemberId(null);
    setHighlightMemberId(null);
  }, []);

  const savedWorkingHoursRef = useRef(false);

  const handleViewChange = useCallback(
    (newView: CalendarView) => {
      if (newView === "month" && view !== "month") {
        savedWorkingHoursRef.current = filters.showWorkingHours;
        setFilters((f) => ({ ...f, showWorkingHours: false }));
      } else if (newView !== "month" && view === "month") {
        setFilters((f) => ({
          ...f,
          showWorkingHours: savedWorkingHoursRef.current,
        }));
      }
      setView(newView);
    },
    [view, filters.showWorkingHours],
  );

  // Handle click on a specific member's day cell in the week view
  const handleMemberDayClick = useCallback(
    (memberId: string, date: Date) => {
      setCurrentDate(date);
      // Store as pending - will be activated after loading completes
      setPendingHighlightMemberId(memberId);
      handleViewChange("day");
    },
    [handleViewChange],
  );

  // When loading finishes and we have a pending highlight, activate it
  useEffect(() => {
    if (!isLoading && pendingHighlightMemberId && view === "day") {
      // Activate the highlight now that the view is visible
      setHighlightMemberId(pendingHighlightMemberId);
      setPendingHighlightMemberId(null);

      // Clear highlight after animation duration (1.5s)
      const timer = setTimeout(() => {
        setHighlightMemberId(null);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [isLoading, pendingHighlightMemberId, view]);

  // Filter entries based on selected members and filters
  const filteredEntries = useMemo(() => {
    // If working hours filter is off, return empty array (no time entries to show)
    if (!filters.showWorkingHours) {
      return [];
    }

    return isAdminOrManager
      ? entries.filter((e) => selectedMembers.includes(e.userId))
      : entries.filter((e) => e.userId === currentUserId);
  }, [
    entries,
    selectedMembers,
    isAdminOrManager,
    currentUserId,
    filters.showWorkingHours,
  ]);

  const filteredMembers = useMemo(
    () =>
      isAdminOrManager
        ? members.filter((m) => selectedMembers.includes(m.user_id))
        : members.filter((m) => m.user_id === currentUserId),
    [members, selectedMembers, isAdminOrManager, currentUserId],
  );

  const filteredJobs = useMemo(() => {
    if (!filters.showJobs) return [];

    return isAdminOrManager
      ? calendarJobs.filter(
          (j) =>
            j.assignedUserIds.length === 0 ||
            j.assignedUserIds.some((uid) => selectedMembers.includes(uid)),
        )
      : calendarJobs.filter((j) => j.assignedUserIds.includes(currentUserId));
  }, [
    calendarJobs,
    filters.showJobs,
    selectedMembers,
    isAdminOrManager,
    currentUserId,
  ]);

  const filteredParkedJobs = useMemo(() => {
    if (!isAdminOrManager) return [];
    return parkedJobs.filter(
      (j) =>
        j.assignedUserIds.length === 0 ||
        j.assignedUserIds.some((uid) => selectedMembers.includes(uid)),
    );
  }, [parkedJobs, selectedMembers, isAdminOrManager]);

  const memberNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.user_id] =
        m.first_name || m.last_name
          ? `${m.first_name || ""} ${m.last_name || ""}`.trim()
          : m.email;
    }
    return map;
  }, [members]);

  const handleParkJob = useCallback(
    (jobId: string) => {
      clearCalendarDragState();
      const job = calendarJobsRef.current.find((j) => j.id === jobId);
      if (!job) return;
      const authoritativeJobId =
        job.jobId ?? (job.occurrenceId ? null : job.id);
      if (!authoritativeJobId) {
        showParkplatzBanner({
          variant: "error",
          message:
            "Interne Termine werden abgesagt oder verschoben, nicht geparkt.",
        });
        return;
      }
      const parkedJob: CalendarJob = {
        ...job,
        id: authoritativeJobId,
        occurrenceId: undefined,
        jobId: authoritativeJobId,
      };

      setParkingContextJob(parkedJob);
    },
    [showParkplatzBanner],
  );

  const handleUnparkJob = useCallback(
    async (
      jobId: string,
      targetDate: string,
      targetTime?: string,
      assignToUserId?: string,
      durationMinutes?: number,
    ) => {
      clearCalendarDragState();
      const parkedList = parkedJobsRef.current;
      const jobIndex = parkedList.findIndex((j) => j.id === jobId);
      const job = jobIndex >= 0 ? parkedList[jobIndex] : null;
      if (!job) return;
      const parkingContexts = parkingContextsRef.current;
      if (!parkingContexts) {
        showParkplatzBanner({
          variant: "error",
          message: "Der Parkplatz-Kontext konnte nicht geladen werden.",
        });
        return;
      }
      const parkingContext = parkingContexts.get(jobId);
      if (!parkingContext) {
        showParkplatzBanner({
          variant: "error",
          message:
            "Der Parkplatz wurde inzwischen geändert. Bitte lade die Ansicht neu.",
        });
        void fetchParkingContexts();
        fetchParkedJobs();
        return;
      }

      const nextDurationMinutes =
        targetTime && job.estimatedDurationMinutes == null
          ? (durationMinutes ?? 240)
          : job.estimatedDurationMinutes;

      const newJob: CalendarJob = {
        ...job,
        plannedDate: targetDate,
        plannedTime: targetTime ?? null,
        estimatedDurationMinutes: nextDurationMinutes,
        status: "nicht_bearbeitet",
      };

      if (assignToUserId && !job.assignedUserIds.includes(assignToUserId)) {
        newJob.assignedUserIds = [...job.assignedUserIds, assignToUserId];
      }

      const removeFromCalendar = () =>
        setCalendarJobs((prev) => prev.filter((j) => j.id !== jobId));
      const putBackInParkplatz = () =>
        setParkedJobs((prev) => {
          const next = prev.filter((j) => j.id !== jobId);
          next.splice(Math.min(jobIndex, next.length), 0, job);
          return next;
        });

      // Optimistic: the card leaves the Parkplatz and lands on the calendar
      // before any server call; each failure below puts it back.
      const releaseOperation = handleOperationStart();
      try {
        setParkedJobs((prev) => prev.filter((j) => j.id !== jobId));
        setCalendarJobs((prev) => [...prev, newJob]);

        const unparkResult = await unparkWorkTarget({
          targetType: "job",
          targetId: jobId,
          blockerVersion: parkingContext.version,
          reason: "Im Kalender neu eingeplant",
        }).catch(() => ({
          success: false as const,
          error: "work_action_failed",
        }));
        if (!scopeActive.current) return;
        if (!unparkResult.success) {
          removeFromCalendar();
          putBackInParkplatz();
          showParkplatzBanner({
            variant: "error",
            message: "Der Parkplatz konnte nicht verlassen werden.",
          });

          return;
        }

        const restoreParking = async (): Promise<boolean> => {
          if (!scopeActive.current) return false;
          if (
            !parkingContext.responsibleEmployeeRecordId ||
            !parkingContext.nextReviewDate
          ) {
            showParkplatzBanner({
              variant: "error",
              message:
                "Der frühere Parkplatz-Kontext konnte nicht wiederhergestellt werden.",
            });
            return false;
          }
          const restoreResult = await parkWorkTarget({
            targetType: "job",
            targetId: jobId,
            expectedExecutionVersion: job.executionVersion ?? 0,
            reason: parkingContext.reason,
            ...(parkingContext.note !== null ? { details: parkingContext.note } : {}),
            responsibleEmployeeRecordId:
              parkingContext.responsibleEmployeeRecordId,
            nextReviewDate: parkingContext.nextReviewDate,
          }).catch(() => ({
            success: false as const,
            error: "work_action_failed",
          }));
          if (!restoreResult.success) {
            showParkplatzBanner({
              variant: "error",
              message:
                "Der frühere Parkplatz-Kontext konnte nicht wiederhergestellt werden.",
            });
            return false;
          }
          return true;
        };
        // Re-park and, once that holds, move the card back to where it was.
        const revertToParkplatz = async () => {
          const restored = await restoreParking();
          removeFromCalendar();
          if (restored) putBackInParkplatz();
        };

        // updateJob with a planned_date on a geparkt job auto-sets status to nicht_bearbeitet
        const result = await updateJob(jobId, {
          plannedDate: targetDate,
          plannedTime: targetTime ?? "",
          ...(nextDurationMinutes !== job.estimatedDurationMinutes
            ? { estimatedDurationMinutes: nextDurationMinutes }
            : {}),
          selectedUserIds: newJob.assignedUserIds,
        });
        if (!result.success) {
          await revertToParkplatz();
          if (result.error !== "qualification_declined") {
            showParkplatzBanner({
              variant: "error",
              message: "Auftrag konnte nicht eingeplant werden.",
            });
          }

          return;
        }

        showParkplatzBanner({
          variant: "success",
          message: "Auftrag wurde eingeplant.",
          onUndo: async () => {
            const releaseOperation = handleOperationStart();
            try {
              await revertToParkplatz();
              if (assignToUserId && !job.assignedUserIds.includes(assignToUserId)) {
                reportUndoResult(
                  await updateJob(jobId, { selectedUserIds: job.assignedUserIds }),
                );
              }

            } finally {
              releaseOperation();
            }
          },
        });

      } finally {
        releaseOperation();
      }
    },
    [
      fetchParkedJobs,
      fetchParkingContexts,
      handleOperationStart,
      reportUndoResult,
      updateJob,
      showParkplatzBanner,
      setCalendarJobs,
    ],
  );

  // The dialog calls this after local validation and before persistence, so
  // the card reaches the Parkplatz in the same frame as the submit. Its
  // failure callback restores the previous calendar placement.
  const handleJobParkStart = useCallback(
    (job: CalendarJob) => {
      const jobId = job.jobId ?? job.id;
      const releaseOperation = handleOperationStart();
      setCalendarJobs((prev) =>
        prev.filter((entry) => (entry.jobId ?? entry.id) !== jobId),
      );
      setParkedJobs((prev) =>
        prev.some((entry) => entry.id === jobId)
          ? prev
          : [
              {
                ...job,
                id: jobId,
                occurrenceId: undefined,
                jobId,
                status: "geparkt",
                plannedDate: null,
                plannedTime: null,
              },
              ...prev,
            ],
      );
      return releaseOperation;
    },
    [handleOperationStart, setCalendarJobs],
  );

  const handleJobParkFailed = useCallback(
    (job: CalendarJob) => {
      const jobId = job.jobId ?? job.id;
      setParkedJobs((prev) => prev.filter((entry) => entry.id !== jobId));
      setCalendarJobs((prev) =>
        prev.some((entry) => (entry.jobId ?? entry.id) === jobId)
          ? prev
          : [...prev, job],
      );
      handleSilentRefresh();
    },
    [handleSilentRefresh, setCalendarJobs],
  );

  // Persistence has settled. Keep the optimistic placement while the
  // authoritative reads converge, then expose undo.
  const handleJobParked = useCallback(
    (job: CalendarJob) => {
      const jobId = job.jobId ?? job.id;
      void fetchParkingContexts();
      const { plannedDate, plannedTime, estimatedDurationMinutes } = job;
      showParkplatzBanner({
        variant: "success",
        message: "Auftrag wurde geparkt.",
        onUndo: plannedDate
          ? async () => {
              // The fresh blocker version must be known before unparking.
              await fetchParkingContexts();
              await handleUnparkJob(
                jobId,
                plannedDate,
                plannedTime ?? undefined,
                undefined,
                estimatedDurationMinutes ?? undefined,
              );
            }
          : undefined,
      });
      handleSilentRefresh();
    },
    [
      fetchParkingContexts,
      handleSilentRefresh,
      handleUnparkJob,
      showParkplatzBanner,
    ],
  );

  const handleScheduleJob = useCallback(
    async (
      jobId: string,
      time: string,
      memberId: string,
      durationMinutes: number,
    ) => {
      clearCalendarDragState();
      const job = calendarJobsRef.current.find((j) => j.id === jobId);
      if (!job) return;

      const origTime = job.plannedTime;
      const origDuration = job.estimatedDurationMinutes;
      const origAssigned = [...job.assignedUserIds];
      const needsAssign = !job.assignedUserIds.includes(memberId);
      const nextDurationMinutes =
        job.estimatedDurationMinutes ?? durationMinutes ?? 240;

      const newAssigned = needsAssign
        ? [...job.assignedUserIds, memberId]
        : job.assignedUserIds;

      const revert = () =>
        setCalendarJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  plannedTime: origTime,
                  estimatedDurationMinutes: origDuration,
                  assignedUserIds: origAssigned,
                }
              : j,
          ),
        );

      const releaseOperation = handleOperationStart();
      try {
        setCalendarJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  plannedTime: time,
                  estimatedDurationMinutes: nextDurationMinutes,
                  assignedUserIds: newAssigned,
                }
              : j,
          ),
        );

        const result = await updateJob(jobId, {
          plannedTime: time,
          estimatedDurationMinutes: nextDurationMinutes,
          selectedUserIds: newAssigned,
        });
        if (!result.success) {
          revert();
          if (result.error !== "qualification_declined") {
            showParkplatzBanner({
              variant: "error",
              message: "Auftrag konnte nicht eingeplant werden.",
            });
          }

          return;
        }

        showParkplatzBanner({
          variant: "success",
          message: "Auftrag wurde eingeplant.",
          onUndo: async () => {
            const releaseOperation = handleOperationStart();
            try {
              revert();
              reportUndoResult(
                await updateJob(jobId, {
                  plannedTime: origTime ?? "",
                  estimatedDurationMinutes: origDuration ?? null,
                  selectedUserIds: origAssigned,
                }),
              );

            } finally {
              releaseOperation();
            }
          },
        });

      } finally {
        releaseOperation();
      }
    },
    [
      handleOperationStart,
      reportUndoResult,
      updateJob,
      showParkplatzBanner,
      setCalendarJobs,
    ],
  );

  const handleJobWeekHeaderMove = useCallback(
    async (jobId: string, newDate: string, oldMemberId?: string) => {
      const job = calendarJobsRef.current.find((j) => j.id === jobId);
      if (!job) return;

      const dateChanged = job.plannedDate !== newDate;
      const memberRemoved =
        !!oldMemberId && job.assignedUserIds.includes(oldMemberId);
      if (!dateChanged && !memberRemoved) return;

      const origDate = job.plannedDate;
      const origAssigned = [...job.assignedUserIds];
      const newAssigned = memberRemoved
        ? job.assignedUserIds.filter((uid) => uid !== oldMemberId)
        : job.assignedUserIds;

      const revert = () =>
        setCalendarJobs((prev) =>
          prev.map((entry) =>
            entry.id === jobId
              ? { ...entry, plannedDate: origDate, assignedUserIds: origAssigned }
              : entry,
          ),
        );

      const releaseOperation = handleOperationStart();
      try {
        setCalendarJobs((prev) =>
          prev.map((entry) =>
            entry.id === jobId
              ? { ...entry, plannedDate: newDate, assignedUserIds: newAssigned }
              : entry,
          ),
        );

        const result = await updateJob(jobId, {
          ...(dateChanged ? { plannedDate: newDate } : {}),
          selectedUserIds: newAssigned,
        });
        if (!result.success) {
          revert();
          if (result.error !== "qualification_declined") {
            showParkplatzBanner({
              variant: "error",
              message: "Auftrag konnte nicht verschoben werden.",
            });
          }

          return;
        }

        showParkplatzBanner({
          variant: "success",
          message: "Auftrag wurde verschoben.",
          onUndo: async () => {
            const releaseOperation = handleOperationStart();
            try {
              revert();
              reportUndoResult(
                await updateJob(jobId, {
                  ...(dateChanged ? { plannedDate: origDate ?? "" } : {}),
                  selectedUserIds: origAssigned,
                }),
              );

            } finally {
              releaseOperation();
            }
          },
        });

      } finally {
        releaseOperation();
      }
    },
    [
      handleOperationStart,
      reportUndoResult,
      updateJob,
      showParkplatzBanner,
      setCalendarJobs,
    ],
  );

  const handleJobDateChange = useCallback(
    async (jobId: string, newDate: string, newTime?: string) => {
      const job = calendarJobsRef.current.find((j) => j.id === jobId);
      if (!job) return;

      const origDate = job.plannedDate;
      const origTime = job.plannedTime;
      const revert = () =>
        setCalendarJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, plannedDate: origDate, plannedTime: origTime }
              : j,
          ),
        );

      const releaseOperation = handleOperationStart();
      try {
        setCalendarJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  plannedDate: newDate,
                  plannedTime: newTime ?? j.plannedTime,
                }
              : j,
          ),
        );

        const result = await updateJob(jobId, {
          plannedDate: newDate,
          ...(newTime !== undefined ? { plannedTime: newTime } : {}),
        });
        if (!result.success) {
          revert();
          if (result.error !== "qualification_declined") {
            showParkplatzBanner({
              variant: "error",
              message: "Auftrag konnte nicht verschoben werden.",
            });
          }

          return;
        }

        showParkplatzBanner({
          variant: "success",
          message: "Auftrag wurde verschoben.",
          onUndo: async () => {
            const releaseOperation = handleOperationStart();
            try {
              revert();
              reportUndoResult(
                await updateJob(jobId, {
                  plannedDate: origDate ?? "",
                  plannedTime: origTime ?? "",
                }),
              );

            } finally {
              releaseOperation();
            }
          },
        });

      } finally {
        releaseOperation();
      }
    },
    [
      handleOperationStart,
      reportUndoResult,
      updateJob,
      showParkplatzBanner,
      setCalendarJobs,
    ],
  );

  const handleJobWeekMove = useCallback(
    async (
      jobId: string,
      newDate: string,
      newMemberId: string,
      oldMemberId: string,
    ) => {
      const job = calendarJobsRef.current.find((j) => j.id === jobId);
      if (!job) return;

      const dateChanged = job.plannedDate !== newDate;
      const memberChanged = oldMemberId !== newMemberId;
      if (!dateChanged && !memberChanged) return;
      if (memberChanged && job.assignedUserIds.includes(newMemberId)) return;

      const origDate = job.plannedDate;
      const origTime = job.plannedTime;
      const origAssigned = [...job.assignedUserIds];
      const newAssigned = memberChanged
        ? job.assignedUserIds.length === 0
          ? [newMemberId]
          : job.assignedUserIds.map((uid) =>
              uid === oldMemberId ? newMemberId : uid,
            )
        : job.assignedUserIds;

      const revert = () =>
        setCalendarJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  plannedDate: origDate,
                  plannedTime: origTime,
                  assignedUserIds: origAssigned,
                }
              : j,
          ),
        );

      const releaseOperation = handleOperationStart();
      try {
        setCalendarJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, plannedDate: newDate, assignedUserIds: newAssigned }
              : j,
          ),
        );

        const result = await updateJob(jobId, {
          ...(dateChanged ? { plannedDate: newDate } : {}),
          selectedUserIds: newAssigned,
        });
        if (!result.success) {
          revert();
          if (result.error !== "qualification_declined") {
            showParkplatzBanner({
              variant: "error",
              message: "Auftrag konnte nicht verschoben werden.",
            });
          }

          return;
        }

        showParkplatzBanner({
          variant: "success",
          message: "Auftrag wurde verschoben.",
          onUndo: async () => {
            const releaseOperation = handleOperationStart();
            try {
              revert();
              reportUndoResult(
                await updateJob(jobId, {
                  ...(dateChanged
                    ? { plannedDate: origDate ?? "", plannedTime: origTime ?? "" }
                    : {}),
                  selectedUserIds: origAssigned,
                }),
              );

            } finally {
              releaseOperation();
            }
          },
        });

      } finally {
        releaseOperation();
      }
    },
    [
      handleOperationStart,
      reportUndoResult,
      updateJob,
      showParkplatzBanner,
      setCalendarJobs,
    ],
  );

  const handleSessionWeekMove = useCallback(
    async (session: WorkSession, newDate: string, newMemberId: string) => {
      const interactiveSession = session as InteractiveCalendarSession;
      const clockInId = session.clockIn?.id;
      const clockOutId = session.clockOut?.id;
      if (!clockInId || !clockOutId || !session.clockIn || !session.clockOut)
        return;

      const clockIn = entriesRef.current.find((e) => e.id === clockInId);
      const clockOut = entriesRef.current.find((e) => e.id === clockOutId);
      if (!clockIn || !clockOut) return;

      const origCi = { ...clockIn };
      const origCo = { ...clockOut };

      const moveTs = (ts: string, targetDate: string) => {
        const orig = new Date(ts);
        const [y, m, d] = targetDate.split("-").map(Number);
        if (y === undefined || m === undefined || d === undefined) return ts;
        return new Date(
          y,
          m - 1,
          d,
          orig.getHours(),
          orig.getMinutes(),
          orig.getSeconds(),
          orig.getMilliseconds(),
        ).toISOString();
      };

      const dateChanged =
        toLocalDateString(new Date(clockIn.timestamp)) !== newDate;
      const memberChanged = clockIn.userId !== newMemberId;
      if (!dateChanged && !memberChanged) return;

      const todayKey = toLocalDateString(new Date());
      if (newDate > todayKey) {
        showParkplatzBanner({
          variant: "error",
          message:
            "Zeiteinträge können nicht in die Zukunft verschoben werden.",
        });
        return;
      }

      const newCiTs = dateChanged
        ? moveTs(clockIn.timestamp, newDate)
        : clockIn.timestamp;
      const newCoTs = dateChanged
        ? moveTs(clockOut.timestamp, newDate)
        : clockOut.timestamp;
      const sourceEntries = interactiveSession.sourceEntries ?? [
        clockIn,
        clockOut,
      ];
      const deltaMs =
        new Date(newCiTs).getTime() - new Date(clockIn.timestamp).getTime();
      const batchUpdates = sourceEntries.map((entry) => ({
        entryId: entry.id,
        newUserId: newMemberId,
        newTimestamp:
          entry.id === clockInId
            ? newCiTs
            : entry.id === clockOutId
              ? newCoTs
              : new Date(
                  new Date(entry.timestamp).getTime() + deltaMs,
                ).toISOString(),
      }));

      const revert = () =>
        setEntries((prev) =>
          prev.map(
            (e) => sourceEntries.find((entry) => entry.id === e.id) ?? e,
          ),
        );

      const releaseOperation = handleOperationStart();
      try {
        setEntries((prev) =>
          prev.map((e) => {
            const batchUpdate = batchUpdates.find(
              (update) => update.entryId === e.id,
            );
            if (batchUpdate) {
              return {
                ...e,
                timestamp: batchUpdate.newTimestamp,
                userId: batchUpdate.newUserId,
              };
            }
            return e;
          }),
        );

        const result =
          sourceEntries.length > 2
            ? await reassignEntryBatch(batchUpdates)
            : await reassignEntries(
                clockInId,
                clockOutId,
                newMemberId,
                newCiTs,
                newCoTs,
              );
        if (!result.success) {
          revert();
          showParkplatzBanner({
            variant: "error",
            message:
              result.error === "overlapping_session"
                ? "Überlappende Arbeitszeit am Ziel."
                : "Eintrag konnte nicht verschoben werden.",
          });

          return;
        }

        showParkplatzBanner({
          variant: "success",
          message: "Eintrag wurde verschoben.",
          onUndo: async () => {
            const releaseOperation = handleOperationStart();
            try {
              revert();
              reportUndoResult(
                sourceEntries.length > 2
                  ? await reassignEntryBatch(
                      sourceEntries.map((entry) => ({
                        entryId: entry.id,
                        newUserId: entry.userId,
                        newTimestamp: entry.timestamp,
                      })),
                    )
                  : await reassignEntries(
                      clockInId,
                      clockOutId,
                      origCi.userId,
                      origCi.timestamp,
                      origCo.timestamp,
                    ),
              );

            } finally {
              releaseOperation();
            }
          },
        });

      } finally {
        releaseOperation();
      }
    },
    [
      handleOperationStart,
      reportUndoResult,
      showParkplatzBanner,
      setEntries,
    ],
  );

  // Use the custom renderers for day/week so break-aware work blocks behave
  // consistently for every role. FullCalendar remains the month renderer.
  const useFullCalendar = view === "month";

  const handleEventClick = useCallback(
    (session: WorkSession) => {
      const sessionUserId = session.clockIn?.userId || session.clockOut?.userId;
      const sessionMember = members.find(
        (member) => member.user_id === sessionUserId,
      );
      const employeeName = sessionMember
        ? sessionMember.first_name || sessionMember.last_name
          ? `${sessionMember.first_name || ""} ${sessionMember.last_name || ""}`.trim()
          : sessionMember.email
        : null;

      setSelectedSession({
        ...(session as InteractiveCalendarSession),
        employeeName,
        ...(sessionMember ? { employeeRole: sessionMember.role as OrgRole } : {}),
      });
    },
    [members],
  );

  const showLoadingSkeleton = isLoading;
  const showUnavailable = !showLoadingSkeleton && readiness.kind === "unavailable";
  const [renderedMonthDate, setRenderedMonthDate] = useState<string | null>(null);
  const monthReady = view !== "month" || renderedMonthDate === toLocalDateString(currentDate);
  const calendarState = readiness.kind === "ready" && !monthReady ? "loading" : readiness.kind;
  const calendarStale = readiness.kind === "ready" && readiness.isStale;

  // Readiness marker for measured navigation (PF-22): set from an effect,
  // so it exists only after hydration and after the data owner reports
  // coverage of the rendered window. Tests read the same state users see.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const neededStartIso = needed.start.toISOString();
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;
    element.dataset.calendarState = calendarState;
    element.dataset.calendarView = view;
    element.dataset.calendarRangeStart = neededStartIso;
    element.dataset.calendarStale = calendarStale ? "true" : "false";
  }, [calendarState, calendarStale, view, neededStartIso]);

  return (
    <PageShell>
      <div ref={calendarHeaderRef}>
        <CalendarHeader
          currentDate={currentDate}
          view={view}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onToday={handleToday}
          onRefresh={handleManualRefresh}
          onManualEntrySuccess={handleManualEntrySuccess}
          isAdminOrManager={isAdminOrManager}
          onJobSuccess={handleSilentRefresh}
          parkedJobCount={filteredParkedJobs.length}
          parkplatzOpen={parkplatzOpen}
          onParkplatzToggle={() => setParkplatzOpen((v) => !v)}
          onParkJob={handleParkJob}
          parkplatzButtonRef={parkplatzButtonRef}
          isPointerOverParkplatz={fcDragOverParkplatz}
          dispatchPanelOpen={dispatchPanelOpen}
          onDispatchPanelToggle={() => {
            setDispatchPanelOpen((open) => !open);
            setParkplatzOpen(false);
          }}
        />
      </div>

      <div className="border-b px-4 py-2 sm:px-6">
        <CalendarViewTabs
          view={view}
          onViewChange={handleViewChange}
          members={members}
          selectedMembers={selectedMembers}
          onSelectedMembersChange={setSelectedMembers}
          isAdminOrManager={isAdminOrManager}
          filters={filters}
          onFiltersChange={setFilters}
        />
      </div>

      {/* The calendar keeps its own scroller (the day and week grids scroll
          sideways inside it, a named canon exception), so PageBody only
          supplies the column slot: padding and clock clearance switched off. */}
      <PageBody className="flex flex-col p-0 pb-0 sm:p-0 sm:pb-0 overflow-hidden">
        <div
          className={cn(
            "flex-1 overflow-auto overscroll-none transition-opacity",
            isReloading && "opacity-60",
          )}
          data-calendar-scroll-container=""
          aria-busy={isReloading || undefined}
          inert={isReloading || calendarStale || undefined}
          ref={scrollContainerRef}
        >
          {showUnavailable ? (
            <div className="p-4 sm:p-6">
              <SectionError
                title="Kalender konnte nicht geladen werden"
                onRetry={() => void handleManualRefresh()}
              >
                Die Termine und Arbeitszeiten für diesen Zeitraum konnten nicht
                geladen werden. Die Navigation bleibt möglich.
              </SectionError>
            </div>
          ) : showLoadingSkeleton ? (
            // Show appropriate skeleton based on view and user role
            useFullCalendar ? (
              <FullCalendarSkeleton view={view} />
            ) : view === "day" ? (
              <DayViewSkeleton memberCount={filteredMembers.length || 5} />
            ) : (
              <WeekViewSkeleton memberCount={filteredMembers.length || 5} />
            )
          ) : useFullCalendar ? (
            <FullCalendarView
              date={currentDate}
              view={view}
              onRendererReady={setRenderedMonthDate}
              entries={filteredEntries}
              members={members}
              organizationSettings={organizationSettings}
              holidayCalendar={liveHolidayCalendar}
              vacationEntries={vacationEntries}
              sicknessEntries={sicknessEntries}
              currentUserId={currentUserId}
              isAdminOrManager={isAdminOrManager}
              onEventClick={handleEventClick}
              onDateSelect={handleDateSelect}
              onViewChange={handleViewChange}
              jobs={filteredJobs}
              onJobDateChange={handleJobDateChange}
              onParkJob={handleParkJob}
              onUnparkJob={handleUnparkJob}
              parkplatzZoneRef={parkplatzButtonRef}
              parkplatzPanelOpen={parkplatzOpen}
              onSessionDateChange={handleSessionWeekMove}
              onPointerOverParkplatzChange={setFcDragOverParkplatz}
            />
          ) : (
            <>
              {view === "day" && (
                <DayView
                  date={currentDate}
                  entries={filteredEntries}
                  members={filteredMembers}
                  organizationSettings={organizationSettings}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                  isAdminOrManager={isAdminOrManager}
                  isLoading={isLoading}
                  onRefresh={handleManualRefresh}
                  onSilentRefresh={handleSilentRefresh}
                  onOperationStart={handleOperationStart}
                  isScopeActive={isScopeActive}
                  onUpdateJob={updateJob}
                  onManualEntrySuccess={handleManualEntrySuccess}
                  onJobSuccess={handleSilentRefresh}
                  changeRequestMap={changeRequestMap}
                  highlightMemberId={highlightMemberId}
                  jobs={filteredJobs}
                  onParkJob={handleParkJob}
                  onUnparkJob={handleUnparkJob}
                  onScheduleJob={handleScheduleJob}
                  parkplatzButtonRef={parkplatzButtonRef}
                  parkplatzDragJob={parkplatzDragJob}
                />
              )}
              {view === "week" && (
                <WeekView
                  date={currentDate}
                  entries={filteredEntries}
                  members={filteredMembers}
                  organizationSettings={organizationSettings}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                  isAdminOrManager={isAdminOrManager}
                  isLoading={isLoading}
                  onDateSelect={handleDateSelect}
                  onViewChange={handleViewChange}
                  onSessionClick={handleEventClick}
                  changeRequestMap={changeRequestMap}
                  onMemberDayClick={handleMemberDayClick}
                  jobs={filteredJobs}
                  onParkJob={handleParkJob}
                  onUnparkJob={handleUnparkJob}
                  onJobWeekMove={handleJobWeekMove}
                  onJobWeekHeaderMove={handleJobWeekHeaderMove}
                  onSessionWeekMove={handleSessionWeekMove}
                />
              )}
            </>
          )}
        </div>
      </PageBody>

      {isAdminOrManager && parkplatzOpen && (
        <ParkplatzPanel
          jobs={filteredParkedJobs}
          onClose={() => setParkplatzOpen(false)}
          memberNames={memberNameMap}
          onParkJob={handleParkJob}
          onDragJobStart={(job) => setParkplatzDragJob(job)}
          onDragJobEnd={() => setParkplatzDragJob(null)}
          isExternalDragOver={fcDragOverParkplatz}
          primaryHeaderHeight={calendarHeaderHeight}
          parkingContexts={parkingContexts ?? undefined}
          onEditContext={(job) => setParkingContextJob(job)}
          onDispatchJob={(job) => setParkedDispatchJob(job)}
        />
      )}

      {isAdminOrManager && dispatchPanelOpen && (
        <DispatchPanel
          onClose={() => setDispatchPanelOpen(false)}
          onChanged={handleSilentRefresh}
          primaryHeaderHeight={calendarHeaderHeight}
        />
      )}

      {isAdminOrManager && parkingContextJob && (
        <ParkingContextDialog
          jobId={parkingContextJob.jobId ?? parkingContextJob.id}
          jobTitle={parkingContextJob.title}
          expectedExecutionVersion={parkingContextJob.executionVersion ?? 0}
          isAlreadyParked={parkingContextJob.status === "geparkt"}
          existingContext={
            parkingContexts?.get(
              parkingContextJob.jobId ?? parkingContextJob.id,
            ) ?? null
          }
          onClose={() => setParkingContextJob(null)}
          onSaveStart={() => {
            if (parkingContextJob.status !== "geparkt") {
              return handleJobParkStart(parkingContextJob);
            }
            return handleOperationStart();
          }}
          onSaveFailed={() => {
            if (parkingContextJob.status !== "geparkt") {
              handleJobParkFailed(parkingContextJob);
            }
          }}
          onSaved={() => {
            const job = parkingContextJob;
            setParkingContextJob(null);
            if (job.status !== "geparkt") {
              handleJobParked(job);
              return;
            }
            void fetchParkingContexts();
            showParkplatzBanner({
              variant: "success",
              message: "Parkplatz-Kontext wurde gespeichert.",
            });
          }}
        />
      )}

      {isAdminOrManager && parkedDispatchJob && (
        <DispatchIssueDialog
          target={{ jobId: parkedDispatchJob.jobId ?? parkedDispatchJob.id }}
          defaultRecipientUserIds={parkedDispatchJob.assignedUserIds}
          onClose={() => setParkedDispatchJob(null)}
          onIssued={() => {
            setParkedDispatchJob(null);
            handleSilentRefresh();
          }}
        />
      )}

      {/* Floating drag preview that follows cursor during parkplatz drags */}
      {parkplatzDragJob &&
        parkplatzDragCursor &&
        (() => {
          // In day view, only show the card preview when cursor is over parkplatz
          // (the day-view component renders its own purple block for the timeline)
          const isDayView = !useFullCalendar && view === "day";
          if (isDayView && !cursorOverParkplatz) return null;

          return (
            <div
              className="fixed pointer-events-none z-[9999]"
              style={{
                left: parkplatzDragCursor.x - 100,
                top: parkplatzDragCursor.y - 30,
              }}
            >
              <div
                className={cn(
                  "w-[200px] rounded-lg border bg-card p-2.5 shadow-xl opacity-90 transition-transform duration-75",
                  "border-brand-purple/40",
                )}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Briefcase className="size-3 shrink-0 text-brand-purple" />
                  <span className="font-medium text-xs truncate">
                    {parkplatzDragJob.title}
                  </span>
                </div>
                {parkplatzDragJob.jobNumber && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {parkplatzDragJob.jobNumber}
                  </span>
                )}
              </div>
            </div>
          );
        })()}

      {/* Entry details dialog for FullCalendar events */}
      {selectedSession && (
        <EntryDetailsDialog
          open={!!selectedSession}
          onOpenChange={(open) => !open && setSelectedSession(null)}
          session={selectedSession}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onRefresh={handleSilentRefresh}
          jobName={
            selectedSession.jobId
              ? (calendarJobs.find((j) => j.id === selectedSession.jobId)
                  ?.title ?? null)
              : null
          }
          entryUserRole={(() => {
            const uid =
              selectedSession.clockIn?.userId ||
              selectedSession.clockOut?.userId;
            return (
              (members.find((m) => m.user_id === uid)?.role as OrgRole) ??
              undefined
            );
          })()}
        />
      )}
      {warningDialog}
      {planningWarningDialog}
    </PageShell>
  );
}
