"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
  getTimeEntries,
  getChangeRequestsForEntries,
  reassignEntries,
  reassignEntryBatch,
} from "@/lib/time-tracking/actions";
import {
  getParkedJobs,
  updateJob as updateJobAction,
  type UpdateJobInput,
} from "@/lib/jobs/actions";
import { parkWorkTarget, unparkWorkTarget } from "@/lib/work-lifecycle/actions";
import {
  getPlanningEntries,
  updatePlanningCalendarEntry,
  type UpdatePlanningCalendarInput,
} from "@/lib/planning/actions";
import { toCalendarJob } from "@/lib/planning/view-model";
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
import { cn } from "@/lib/utils";
import { usePlanningWarningConfirmation } from "./planning-warning-dialog";

const EntryDetailsDialog = dynamic(
  () => import("./entry-details-dialog").then((mod) => mod.EntryDetailsDialog),
  { ssr: false },
);
import type {
  InteractiveCalendarSession,
  TimeEntry,
  WorkSession,
  EntryChangeRequestMap,
} from "@/lib/time-tracking/types";
import type { OrgRole } from "@/lib/members/actions";
import {
  consumeManualEntryBridge,
  MANUAL_ENTRY_CREATED_EVENT,
} from "@/lib/time-tracking/manual-entry-bridge";
import type { OrganizationTimeTrackingSettings } from "@/lib/time-tracking/settings";
import type { OrganizationHolidayCalendar } from "@/lib/personnel/targets";
import {
  getVacationCalendarEntries,
  type VacationCalendarEntry,
} from "@/lib/vacation/actions";
import {
  getSicknessCalendarEntries,
  type SicknessCalendarEntry,
} from "@/lib/sickness/actions";
import { toLocalDateString } from "@/lib/utils";
import {
  getCalendarMonthFetchRange,
  shiftCalendarDate,
} from "@/lib/calendar/navigation";

export type CalendarView = "day" | "week" | "month";

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
  /** Holiday/closure context (P1-04), shown in the month view. */
  holidayCalendar?: OrganizationHolidayCalendar;
  initialEntries?: TimeEntry[];
  initialChangeRequestMap?: EntryChangeRequestMap;
  initialJobs?: CalendarJob[];
}

function sortEntriesByTimestamp(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    const timestampDiff =
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (timestampDiff !== 0) return timestampDiff;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function CalendarContainer({
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  members,
  organizationSettings,
  holidayCalendar,
  initialEntries,
  initialChangeRequestMap,
  initialJobs,
}: CalendarContainerProps) {
  const pathname = usePathname();
  const { requestApproval, warningDialog } =
    useQualificationWarningConfirmation();
  const {
    requestApproval: requestPlanningApproval,
    warningDialog: planningWarningDialog,
  } = usePlanningWarningConfirmation();
  const updateJob = useCallback(
    async (jobId: string, input: UpdateJobInput) => {
      const planningEntry = calendarJobsRef.current.find(
        (entry) => entry.id === jobId && entry.occurrenceId,
      );
      if (planningEntry) {
        const planningInput: UpdatePlanningCalendarInput = {
          plannedDate: input.plannedDate || undefined,
          plannedTime: input.plannedTime || undefined,
          estimatedDurationMinutes: input.estimatedDurationMinutes,
          selectedUserIds: input.selectedUserIds,
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
          realtimePausedUntilRef.current = Date.now() + 120_000;
          const approval = await requestPlanningApproval(
            result.conflicts,
            result.fingerprint,
          );
          if (!approval) {
            realtimePausedUntilRef.current = Date.now() + 1000;
            return { success: false as const, error: "qualification_declined" };
          }
          realtimePausedUntilRef.current = Date.now() + 8000;
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
        // The dialog blocks on human input and can outlive the mutation pause.
        realtimePausedUntilRef.current = Date.now() + 120_000;
        const approval = await requestApproval(result.evaluation);
        if (!approval) {
          realtimePausedUntilRef.current = Date.now() + 1000;
          return {
            success: false as const,
            error: "qualification_declined" as const,
          };
        }
        if (approval) {
          // The confirmation dialog may stay open longer than the original
          // mutation pause. Extend it before the approved retry so its own
          // Realtime events cannot race the optimistic calendar state.
          realtimePausedUntilRef.current = Date.now() + 8000;
          result = await updateJobAction(jobId, {
            ...input,
            assignmentApproval: approval,
          });
        }
      }
      return result;
    },
    [requestApproval, requestPlanningApproval],
  );
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>("day");
  const [entries, setEntries] = useState<TimeEntry[]>(initialEntries ?? []);
  const [changeRequestMap, setChangeRequestMap] =
    useState<EntryChangeRequestMap>(initialChangeRequestMap ?? {});
  const [isLoading, setIsLoading] = useState(!initialEntries);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    members.map((m) => m.user_id),
  );
  const [selectedSession, setSelectedSession] =
    useState<InteractiveCalendarSession | null>(null);
  const [calendarJobs, setCalendarJobs] = useState<CalendarJob[]>(
    initialJobs ?? [],
  );
  // Vacation absence entries (P1-06): approved shown as calm planning state,
  // pending shown provisionally. Loaded client-side and kept Realtime-fresh.
  const [vacationEntries, setVacationEntries] = useState<
    VacationCalendarEntry[]
  >([]);
  const vacationGenerationRef = useRef(0);
  // Organization switches must never show the previous organization's
  // absence entries: reset synchronously during render (React's official
  // adjust-state-on-prop-change pattern) and invalidate in-flight fetches.
  const [vacationEntriesOrgId, setVacationEntriesOrgId] =
    useState(organizationId);
  if (vacationEntriesOrgId !== organizationId) {
    setVacationEntriesOrgId(organizationId);
    setVacationEntries([]);
    vacationGenerationRef.current++;
  }
  const refetchVacationEntries = useCallback(async () => {
    const generation = ++vacationGenerationRef.current;
    try {
      const result = await getVacationCalendarEntries();
      if (generation !== vacationGenerationRef.current) return;
      // Keep last-known entries on transient failure.
      if (result.success) setVacationEntries(result.entries);
    } catch (error) {
      console.error("Error fetching vacation calendar entries:", error);
    }
  }, []);
  useEffect(() => {
    void refetchVacationEntries();
  }, [organizationId, refetchVacationEntries]);
  // Sickness absence entries (P1-08): deliberately neutral („Abwesend") — the
  // shared calendar shows unavailability, never the absence type.
  const [sicknessEntries, setSicknessEntries] = useState<
    SicknessCalendarEntry[]
  >([]);
  const sicknessGenerationRef = useRef(0);
  const [sicknessEntriesOrgId, setSicknessEntriesOrgId] =
    useState(organizationId);
  if (sicknessEntriesOrgId !== organizationId) {
    setSicknessEntriesOrgId(organizationId);
    setSicknessEntries([]);
    sicknessGenerationRef.current++;
  }
  const refetchSicknessEntries = useCallback(async () => {
    const generation = ++sicknessGenerationRef.current;
    try {
      const result = await getSicknessCalendarEntries();
      if (generation !== sicknessGenerationRef.current) return;
      // Keep last-known entries on transient failure.
      if (result.success) setSicknessEntries(result.entries);
    } catch (error) {
      console.error("Error fetching sickness calendar entries:", error);
    }
  }, []);
  useEffect(() => {
    void refetchSicknessEntries();
  }, [organizationId, refetchSicknessEntries]);
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
  const realtimePausedUntilRef = useRef(0);
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

  // In-flight mutation counter. Every mutation handler increments this when it
  // starts and decrements it when the server call (or undo) settles. The
  // debounced silent-refresh only fires once this drops back to 0, ensuring
  // we never fetch from the server while there are still uncommitted changes
  // that would be missing from the response.
  const inflightRef = useRef(0);
  const silentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Refs that always hold the latest state — handlers read from these
  // instead of closing over stale values during rapid successive actions.
  const calendarJobsRef = useRef(calendarJobs);
  calendarJobsRef.current = calendarJobs;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const parkedJobsRef = useRef(parkedJobs);
  parkedJobsRef.current = parkedJobs;

  // Track the date range we've already fetched data for.
  // When switching to a narrower view (e.g. week→day), the needed range
  // is already covered so we skip the refetch entirely.
  const fetchedRangeRef = useRef<{ start: Date; end: Date } | null>(null);
  const hasDataRef = useRef(!!initialEntries);
  const previousOrgIdRef = useRef(organizationId);
  const entriesRequestIdRef = useRef(0);
  const jobsRequestIdRef = useRef(0);
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

  // Calculate date range based on view
  // For proper session pairing, we fetch slightly beyond view boundaries
  const getDateRange = useCallback(() => {
    const start = new Date(currentDate);
    const end = new Date(currentDate);

    if (view === "day") {
      // For day view, also fetch previous day to catch overnight clock_ins
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (view === "week") {
      // Start of week (Monday) - 1 day to catch previous day's clock_ins
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff - 1);
      start.setHours(0, 0, 0, 0);
      // End of week (Sunday) + 1 day to catch next day's clock_outs
      end.setDate(start.getDate() + 8);
      end.setHours(23, 59, 59, 999);
    } else if (view === "month") {
      const monthRange = getCalendarMonthFetchRange(currentDate);
      start.setTime(monthRange.start.getTime());
      end.setTime(monthRange.end.getTime());
    }

    return { start, end };
  }, [currentDate, view]);

  const fetchChangeRequestsForCurrentEntries = useCallback(
    async (
      sourceEntries: TimeEntry[],
      requestId: number,
      requestOrgId: string,
    ) => {
      const entryIds = sourceEntries.map((e) => e.id);
      if (entryIds.length === 0) {
        setChangeRequestMap({});
        return;
      }

      try {
        const crResult = await getChangeRequestsForEntries(entryIds);
        if (
          entriesRequestIdRef.current !== requestId ||
          previousOrgIdRef.current !== requestOrgId
        ) {
          return;
        }

        if (crResult.success && crResult.requests) {
          const crMap: EntryChangeRequestMap = {};
          for (const cr of crResult.requests) {
            crMap[cr.entryId] = cr;
            if (cr.pairedEntryId) {
              crMap[cr.pairedEntryId] = cr;
            }
          }
          setChangeRequestMap(crMap);
        }
      } catch (crError) {
        if (
          entriesRequestIdRef.current !== requestId ||
          previousOrgIdRef.current !== requestOrgId
        ) {
          return;
        }

        console.error("Error fetching change requests:", crError);
      }
    },
    [],
  );

  // Fetch entries and their pending change requests via server actions.
  // - silent=true  → no visual indicator (used by Realtime)
  // - silent=false → spinner in header; skeleton only when no data exists yet
  // Change requests are fetched non-blocking so the calendar renders entries
  // immediately and CR badges fill in shortly after.
  const fetchEntries = useCallback(
    async (silent = false) => {
      const requestId = ++entriesRequestIdRef.current;
      const requestOrgId = organizationId;

      if (!silent) {
        if (!hasDataRef.current) setIsLoading(true);
        setIsRefreshing(true);
      }
      try {
        const { start, end } = getDateRange();

        const result = await getTimeEntries({
          organizationId,
          from: start.toISOString(),
          to: end.toISOString(),
        });

        if (result.success && result.entries) {
          if (
            entriesRequestIdRef.current !== requestId ||
            previousOrgIdRef.current !== requestOrgId
          ) {
            return;
          }

          setEntries(result.entries);
          hasDataRef.current = true;
          fetchedRangeRef.current = { start, end };

          void fetchChangeRequestsForCurrentEntries(
            result.entries,
            requestId,
            requestOrgId,
          );
        } else if (!result.success) {
          console.error("Error fetching entries:", result.error);
        }
      } catch (error) {
        console.error("Error fetching entries:", error);
      } finally {
        if (
          entriesRequestIdRef.current !== requestId ||
          previousOrgIdRef.current !== requestOrgId
        ) {
          return;
        }
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [organizationId, getDateRange, fetchChangeRequestsForCurrentEntries],
  );

  const fetchJobs = useCallback(async () => {
    const requestId = ++jobsRequestIdRef.current;
    const requestOrgId = organizationId;

    try {
      const { start, end } = getDateRange();
      const fromIso = toLocalDateString(start);
      const toIso = toLocalDateString(end);

      const result = await getPlanningEntries(fromIso, toIso);
      if (result.success) {
        if (
          jobsRequestIdRef.current !== requestId ||
          previousOrgIdRef.current !== requestOrgId
        ) {
          return;
        }
        setCalendarJobs(result.entries.map(toCalendarJob));
      }
    } catch (error) {
      console.error("Error fetching calendar jobs:", error);
    }
  }, [organizationId, getDateRange]);

  const fetchParkedJobs = useCallback(async () => {
    const requestId = ++parkedJobsRequestIdRef.current;
    try {
      const result = await getParkedJobs();
      if (parkedJobsRequestIdRef.current !== requestId) return;
      if (result.success) {
        setParkedJobs(result.jobs);
        parkedJobsLoadedRef.current = true;
      }
    } catch (error) {
      console.error("Error fetching parked jobs:", error);
    }
  }, []);

  const hasUsedInitialData = useRef(!!initialEntries);

  useEffect(() => {
    if (previousOrgIdRef.current === organizationId) {
      return;
    }

    previousOrgIdRef.current = organizationId;
    entriesRequestIdRef.current += 1;
    jobsRequestIdRef.current += 1;
    fetchedRangeRef.current = null;
    hasDataRef.current = false;
    hasUsedInitialData.current = false;

    setEntries([]);
    setChangeRequestMap({});
    setCalendarJobs([]);
    setParkedJobs([]);
    parkedJobsLoadedRef.current = false;
    setParkplatzOpen(false);
    // P1-12 state is organization-scoped as well.
    setDispatchPanelOpen(false);
    setParkingContexts(null);
    setParkingContextJob(null);
    setParkedDispatchJob(null);
    setSelectedMembers(members.map((member) => member.user_id));
    setSelectedSession(null);
    setPendingHighlightMemberId(null);
    setHighlightMemberId(null);
    setIsRefreshing(false);
    setIsLoading(true);
  }, [organizationId, members]);

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

  useEffect(() => {
    if (hasUsedInitialData.current) {
      hasUsedInitialData.current = false;
      // Seed the fetched-range ref with the server-prefetched day range
      fetchedRangeRef.current = getDateRange();
      // The calendar page can be revisited from a cached route after mutations
      // happened elsewhere (e.g. manual entries created from Zeiterfassung).
      // Do one background refetch on first mount so the mounted calendar state
      // converges immediately instead of waiting for a manual reload.
      fetchEntries(true);
      fetchJobs();
      return;
    }

    const needed = getDateRange();
    const fetched = fetchedRangeRef.current;

    // Skip refetch when the needed range is within what we already have
    if (fetched && needed.start >= fetched.start && needed.end <= fetched.end) {
      return;
    }

    // Wider data needed — silent refetch (no skeleton) if we have existing data
    fetchEntries(hasDataRef.current);
    fetchJobs();
  }, [fetchEntries, fetchJobs, getDateRange]);

  useEffect(() => {
    if (
      !initialEntries?.length ||
      Object.keys(initialChangeRequestMap ?? {}).length > 0
    ) {
      return;
    }

    void fetchChangeRequestsForCurrentEntries(
      initialEntries,
      entriesRequestIdRef.current,
      organizationId,
    );
  }, [
    fetchChangeRequestsForCurrentEntries,
    initialChangeRequestMap,
    initialEntries,
    organizationId,
  ]);

  // Keep parked jobs loaded for admins so the header count and panel stay fresh.
  useEffect(() => {
    if (isAdminOrManager && !parkedJobsLoadedRef.current) {
      fetchParkedJobs();
    }
  }, [isAdminOrManager, fetchParkedJobs]);

  // P1-12: Parkplatz context (reason/responsible/next review) for managers.
  const parkingContextsRequestIdRef = useRef(0);
  const fetchParkingContexts = useCallback(async () => {
    if (!isAdminOrManager) return;
    const requestId = ++parkingContextsRequestIdRef.current;
    try {
      const result = await getJobParkingContexts();
      // Generation guard: an older response (or one from a previous
      // organization) must never overwrite newer state.
      if (parkingContextsRequestIdRef.current !== requestId) return;
      if (result.success) {
        setParkingContexts(
          new Map(result.contexts.map((context) => [context.jobId, context])),
        );
      }
    } catch (error) {
      // Keep last-known contexts on a transient failure; the panel keeps its
      // labeled missing-context state otherwise.
      console.error("Failed to refresh parking contexts:", error);
    }
  }, [isAdminOrManager]);
  useEffect(() => {
    void fetchParkingContexts();
  }, [fetchParkingContexts, organizationId]);
  useEffect(() => {
    return () => {
      if (silentRefreshTimerRef.current) {
        clearTimeout(silentRefreshTimerRef.current);
      }
    };
  }, []);

  // Realtime consumption goes through the live-view primitive: shared
  // debounce, dialog suspension with one catch-up, and focus/visibility
  // catch-up. The calendar keeps its own fetchers (range cache, optimistic
  // drag-and-drop), so the readers just invoke them. During optimistic DnD
  // operations a Realtime refetch would overwrite the optimistic state with
  // stale server data; the paused-until filter drops those events and the
  // handler's own handleSilentRefresh() at the end brings in the final
  // correct state.
  const notPausedForRealtime = useCallback(
    () => Date.now() >= realtimePausedUntilRef.current,
    [],
  );
  useLiveView<null>({
    tables: ["time_entries", "entry_change_requests"],
    read: async () => {
      await fetchEntries(true);
      return { ok: true, data: null };
    },
    initialData: null,
    eventFilter: notPausedForRealtime,
  });
  useLiveView<null>({
    tables: [
      "jobs",
      "projects",
      "clients",
      "job_assignments",
      "planning_series",
      "planning_occurrences",
      "planning_occurrence_assignments",
      "organization_members",
    ],
    read: async () => {
      await fetchJobs();
      if (isAdminOrManager) {
        await fetchParkedJobs();
      }
      return { ok: true, data: null };
    },
    initialData: null,
    eventFilter: notPausedForRealtime,
  });
  useRealtimeRouterRefresh({
    tables: ["organization_members", "profiles", "organization_settings"],
    eventFilter: notPausedForRealtime,
  });
  useLiveView<null>({
    tables: ["work_blockers"],
    read: async () => {
      await fetchParkingContexts();
      return { ok: true, data: null };
    },
    initialData: null,
    enabled: isAdminOrManager,
    eventFilter: (event) => {
      const kind = (event.new ?? event.old)?.kind;
      return kind == null || kind === "parking";
    },
  });
  // Absence entries refetch without the DnD pause: dragging never touches
  // vacation or sickness facts.
  useLiveView<null>({
    tables: ["vacation_requests"],
    read: async () => {
      await refetchVacationEntries();
      return { ok: true, data: null };
    },
    initialData: null,
  });
  useLiveView<null>({
    tables: ["sickness_reports"],
    read: async () => {
      await refetchSicknessEntries();
      return { ok: true, data: null };
    },
    initialData: null,
  });

  // Force a full refetch with loading skeleton (manual refresh button, after edits, etc.)
  const handleManualRefresh = useCallback(() => {
    fetchedRangeRef.current = null;
    setIsLoading(true);
    fetchEntries();
    fetchJobs();
    // Absence entries refresh too — a manual refresh must never leave stale
    // availability standing when a Realtime event was missed.
    void refetchVacationEntries();
    void refetchSicknessEntries();
    if (isAdminOrManager) fetchParkedJobs();
  }, [
    fetchEntries,
    fetchJobs,
    fetchParkedJobs,
    isAdminOrManager,
    refetchVacationEntries,
    refetchSicknessEntries,
  ]);

  const handleOperationStart = useCallback(() => {
    inflightRef.current++;
    realtimePausedUntilRef.current = Date.now() + 8000;
    // Kill any pending refresh — a new mutation just started so any fetch
    // would return stale data missing this mutation's changes.
    if (silentRefreshTimerRef.current) {
      clearTimeout(silentRefreshTimerRef.current);
      silentRefreshTimerRef.current = null;
    }
    entriesRequestIdRef.current++;
    jobsRequestIdRef.current++;
    parkedJobsRequestIdRef.current++;
  }, []);

  // Called when a mutation (forward or undo) has finished its server call.
  // Decrements the inflight counter and, once it reaches 0, schedules a
  // single debounced fetch so the UI converges with the server state.
  const handleSilentRefresh = useCallback(() => {
    inflightRef.current = Math.max(0, inflightRef.current - 1);

    // Kill any existing scheduled refresh so we debounce properly.
    if (silentRefreshTimerRef.current) {
      clearTimeout(silentRefreshTimerRef.current);
      silentRefreshTimerRef.current = null;
    }

    // If there are still mutations in flight, don't fetch yet — the last
    // one to finish will trigger the real refresh.
    if (inflightRef.current > 0) return;

    // Invalidate any in-flight fetches from previous operations.
    entriesRequestIdRef.current++;
    jobsRequestIdRef.current++;
    parkedJobsRequestIdRef.current++;

    // Small delay so the DB has time to commit the final transaction.
    silentRefreshTimerRef.current = setTimeout(() => {
      silentRefreshTimerRef.current = null;
      // Double-check nothing started while we were waiting.
      if (inflightRef.current > 0) return;
      fetchEntries(true);
      fetchJobs();
      void refetchVacationEntries();
      void refetchSicknessEntries();
      if (isAdminOrManager) fetchParkedJobs();
    }, 300);
  }, [
    fetchEntries,
    fetchJobs,
    fetchParkedJobs,
    isAdminOrManager,
    refetchVacationEntries,
    refetchSicknessEntries,
  ]);

  const { showBanner } = useBanner();
  // Adapter over the global banner (feedback canon): parkplatz/drag successes
  // carry the undo action, errors persist until dismissed. A failed undo still
  // settles the in-flight counter via handleSilentRefresh so later silent
  // refreshes are not suppressed forever.
  const showParkplatzBanner = useCallback(
    (banner: {
      variant: "success" | "error";
      message: string;
      onUndo?: () => Promise<void>;
    }) => {
      showBanner({
        variant: banner.variant,
        message: banner.message,
        ...(banner.variant === "success" && banner.onUndo
          ? {
              actionLabel: "Rückgängig",
              actionIcon: <Undo2 className="size-3.5" />,
              onAction: () => {
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

  const handleManualEntrySuccess = useCallback(
    (newEntries: TimeEntry[]) => {
      handleOperationStart();
      const { start, end } = getDateRange();
      const visibleNewEntries = newEntries.filter((entry) => {
        const timestamp = new Date(entry.timestamp).getTime();
        return timestamp >= start.getTime() && timestamp <= end.getTime();
      });

      if (visibleNewEntries.length > 0) {
        setEntries((prev) => {
          const merged = new Map(prev.map((entry) => [entry.id, entry]));
          for (const entry of visibleNewEntries) {
            merged.set(entry.id, entry);
          }
          return sortEntriesByTimestamp(Array.from(merged.values()));
        });
        hasDataRef.current = true;
      }

      handleSilentRefresh();
    },
    [getDateRange, handleOperationStart, handleSilentRefresh],
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

      handleOperationStart();
      const unparkResult = await unparkWorkTarget({
        targetType: "job",
        targetId: jobId,
        blockerVersion: parkingContext.version,
        reason: "Im Kalender neu eingeplant",
      }).catch(() => ({
        success: false as const,
        error: "work_action_failed",
      }));
      if (!unparkResult.success) {
        showParkplatzBanner({
          variant: "error",
          message: "Der Parkplatz konnte nicht verlassen werden.",
        });
        handleSilentRefresh();
        return;
      }

      const restoreParking = async (): Promise<boolean> => {
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
          details: parkingContext.note ?? undefined,
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

      setParkedJobs((prev) => prev.filter((j) => j.id !== jobId));
      setCalendarJobs((prev) => [...prev, newJob]);

      const undone = { current: false };

      const updatePromise = updateJob(jobId, {
        plannedDate: targetDate,
        plannedTime: targetTime ?? "",
        ...(nextDurationMinutes !== job.estimatedDurationMinutes
          ? { estimatedDurationMinutes: nextDurationMinutes }
          : {}),
        selectedUserIds: newJob.assignedUserIds,
      });

      showParkplatzBanner({
        variant: "success",
        message: "Auftrag wurde eingeplant.",
        onUndo: async () => {
          undone.current = true;
          handleOperationStart();
          await updatePromise;
          const restored = await restoreParking();
          setCalendarJobs((prev) => prev.filter((j) => j.id !== jobId));
          if (restored) {
            setParkedJobs((prev) => {
              const next = [...prev];
              next.splice(Math.min(jobIndex, next.length), 0, job);
              return next;
            });
          }
          if (assignToUserId && !job.assignedUserIds.includes(assignToUserId)) {
            await updateJob(jobId, { selectedUserIds: job.assignedUserIds });
          }
          handleSilentRefresh();
        },
      });

      // updateJob with a planned_date on a geparkt job auto-sets status to nicht_bearbeitet
      const result = await updatePromise;
      if (undone.current) {
        handleSilentRefresh();
        return;
      }

      if (!result.success) {
        const restored = await restoreParking();
        setCalendarJobs((prev) => prev.filter((j) => j.id !== jobId));
        if (restored) {
          setParkedJobs((prev) => {
            const next = [...prev];
            next.splice(Math.min(jobIndex, next.length), 0, job);
            return next;
          });
        }
        if (result.error === "qualification_declined") {
          handleSilentRefresh();
          return;
        }
        showParkplatzBanner({
          variant: "error",
          message: "Auftrag konnte nicht eingeplant werden.",
        });
        handleSilentRefresh();
        return;
      }

      if (!undone.current) handleSilentRefresh();
    },
    [
      fetchParkedJobs,
      fetchParkingContexts,
      handleOperationStart,
      handleSilentRefresh,
      parkingContexts,
      updateJob,
      showParkplatzBanner,
    ],
  );

  const handleScheduleJob = useCallback(
    async (
      jobId: string,
      targetDate: string,
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

      handleOperationStart();
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

      const undone = { current: false };

      showParkplatzBanner({
        variant: "success",
        message: "Auftrag wurde eingeplant.",
        onUndo: async () => {
          undone.current = true;
          handleOperationStart();
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
          await updateJob(jobId, {
            plannedTime: origTime ?? "",
            estimatedDurationMinutes: origDuration ?? null,
            selectedUserIds: origAssigned,
          });
          handleSilentRefresh();
        },
      });

      const result = await updateJob(jobId, {
        plannedTime: time,
        estimatedDurationMinutes: nextDurationMinutes,
        selectedUserIds: newAssigned,
      });
      if (undone.current) {
        handleSilentRefresh();
        return;
      }

      if (!result.success) {
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
        if (result.error === "qualification_declined") {
          handleSilentRefresh();
          return;
        }
        showParkplatzBanner({
          variant: "error",
          message: "Auftrag konnte nicht eingeplant werden.",
        });
        handleSilentRefresh();
        return;
      }

      if (!undone.current) handleSilentRefresh();
    },
    [handleOperationStart, handleSilentRefresh, updateJob, showParkplatzBanner],
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

      handleOperationStart();
      setCalendarJobs((prev) =>
        prev.map((entry) =>
          entry.id === jobId
            ? { ...entry, plannedDate: newDate, assignedUserIds: newAssigned }
            : entry,
        ),
      );

      const undone = { current: false };

      showParkplatzBanner({
        variant: "success",
        message: "Auftrag wurde verschoben.",
        onUndo: async () => {
          undone.current = true;
          handleOperationStart();
          setCalendarJobs((prev) =>
            prev.map((entry) =>
              entry.id === jobId
                ? {
                    ...entry,
                    plannedDate: origDate,
                    assignedUserIds: origAssigned,
                  }
                : entry,
            ),
          );
          await updateJob(jobId, {
            ...(dateChanged ? { plannedDate: origDate ?? "" } : {}),
            selectedUserIds: origAssigned,
          });
          handleSilentRefresh();
        },
      });

      const result = await updateJob(jobId, {
        ...(dateChanged ? { plannedDate: newDate } : {}),
        selectedUserIds: newAssigned,
      });
      if (undone.current) {
        handleSilentRefresh();
        return;
      }
      if (!result.success) {
        setCalendarJobs((prev) =>
          prev.map((entry) =>
            entry.id === jobId
              ? {
                  ...entry,
                  plannedDate: origDate,
                  assignedUserIds: origAssigned,
                }
              : entry,
          ),
        );
        if (result.error === "qualification_declined") {
          handleSilentRefresh();
          return;
        }
        showParkplatzBanner({
          variant: "error",
          message: "Auftrag konnte nicht verschoben werden.",
        });
      }
      handleSilentRefresh();
    },
    [handleOperationStart, handleSilentRefresh, updateJob, showParkplatzBanner],
  );

  const handleJobDateChange = useCallback(
    async (jobId: string, newDate: string, newTime?: string) => {
      const job = calendarJobsRef.current.find((j) => j.id === jobId);
      if (!job) return;

      const origDate = job.plannedDate;
      const origTime = job.plannedTime;

      handleOperationStart();
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

      const undone = { current: false };

      showParkplatzBanner({
        variant: "success",
        message: "Auftrag wurde verschoben.",
        onUndo: async () => {
          undone.current = true;
          handleOperationStart();
          setCalendarJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? { ...j, plannedDate: origDate, plannedTime: origTime }
                : j,
            ),
          );
          await updateJob(jobId, {
            plannedDate: origDate ?? "",
            plannedTime: origTime ?? "",
          });
          handleSilentRefresh();
        },
      });

      const result = await updateJob(jobId, {
        plannedDate: newDate,
        ...(newTime !== undefined ? { plannedTime: newTime } : {}),
      });
      if (undone.current) {
        handleSilentRefresh();
        return;
      }

      if (!result.success) {
        setCalendarJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, plannedDate: origDate, plannedTime: origTime }
              : j,
          ),
        );
        if (result.error === "qualification_declined") {
          handleSilentRefresh();
          return;
        }
        showParkplatzBanner({
          variant: "error",
          message: "Auftrag konnte nicht verschoben werden.",
        });
      }

      handleSilentRefresh();
    },
    [handleOperationStart, handleSilentRefresh, updateJob, showParkplatzBanner],
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

      handleOperationStart();
      setCalendarJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, plannedDate: newDate, assignedUserIds: newAssigned }
            : j,
        ),
      );

      const undone = { current: false };

      showParkplatzBanner({
        variant: "success",
        message: "Auftrag wurde verschoben.",
        onUndo: async () => {
          undone.current = true;
          handleOperationStart();
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
          await updateJob(jobId, {
            ...(dateChanged
              ? { plannedDate: origDate ?? "", plannedTime: origTime ?? "" }
              : {}),
            selectedUserIds: origAssigned,
          });
          handleSilentRefresh();
        },
      });

      const result = await updateJob(jobId, {
        ...(dateChanged ? { plannedDate: newDate } : {}),
        selectedUserIds: newAssigned,
      });
      if (undone.current) {
        handleSilentRefresh();
        return;
      }
      if (!result.success) {
        setCalendarJobs((prev) =>
          prev.map((entry) =>
            entry.id === jobId
              ? {
                  ...entry,
                  plannedDate: origDate,
                  plannedTime: origTime,
                  assignedUserIds: origAssigned,
                }
              : entry,
          ),
        );
        if (result.error === "qualification_declined") {
          handleSilentRefresh();
          return;
        }
        showParkplatzBanner({
          variant: "error",
          message: "Auftrag konnte nicht verschoben werden.",
        });
      }
      handleSilentRefresh();
    },
    [handleOperationStart, handleSilentRefresh, updateJob, showParkplatzBanner],
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

      handleOperationStart();
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

      const undone = { current: false };

      showParkplatzBanner({
        variant: "success",
        message: "Eintrag wurde verschoben.",
        onUndo: async () => {
          undone.current = true;
          handleOperationStart();
          setEntries((prev) =>
            prev.map((e) => {
              const originalEntry = sourceEntries.find(
                (entry) => entry.id === e.id,
              );
              if (originalEntry) return originalEntry;
              return e;
            }),
          );
          if (sourceEntries.length > 2) {
            await reassignEntryBatch(
              sourceEntries.map((entry) => ({
                entryId: entry.id,
                newUserId: entry.userId,
                newTimestamp: entry.timestamp,
              })),
            );
          } else {
            await reassignEntries(
              clockInId,
              clockOutId,
              origCi.userId,
              origCi.timestamp,
              origCo.timestamp,
            );
          }
          handleSilentRefresh();
        },
      });

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
      if (undone.current) {
        handleSilentRefresh();
        return;
      }

      if (!result.success) {
        setEntries((prev) =>
          prev.map((e) => {
            const originalEntry = sourceEntries.find(
              (entry) => entry.id === e.id,
            );
            if (originalEntry) return originalEntry;
            return e;
          }),
        );
        showParkplatzBanner({
          variant: "error",
          message:
            result.error === "overlapping_session"
              ? "Überlappende Arbeitszeit am Ziel."
              : "Eintrag konnte nicht verschoben werden.",
        });
      }

      handleSilentRefresh();
    },
    [handleOperationStart, handleSilentRefresh, showParkplatzBanner],
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
        : undefined;

      setSelectedSession({
        ...(session as InteractiveCalendarSession),
        employeeName,
        employeeRole: sessionMember?.role as OrgRole | undefined,
      });
    },
    [members],
  );

  const isSwitchingCalendarOrg = previousOrgIdRef.current !== organizationId;
  const showLoadingSkeleton = isLoading || isSwitchingCalendarOrg;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div ref={calendarHeaderRef}>
        <CalendarHeader
          currentDate={currentDate}
          view={view}
          isLoading={showLoadingSkeleton || isRefreshing}
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

      <div
        className="flex-1 overflow-auto overscroll-none"
        data-calendar-scroll-container=""
      >
        {showLoadingSkeleton ? (
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
            entries={filteredEntries}
            members={members}
            organizationSettings={organizationSettings}
            holidayCalendar={holidayCalendar}
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
          onSaved={() => {
            const wasAlreadyParked = parkingContextJob.status === "geparkt";
            setParkingContextJob(null);
            void fetchParkingContexts();
            if (!wasAlreadyParked) {
              showParkplatzBanner({
                variant: "success",
                message: "Auftrag wurde geparkt.",
              });
            }
            handleSilentRefresh();
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
    </div>
  );
}
