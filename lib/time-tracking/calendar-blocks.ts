import type { InteractiveCalendarSession, TimeEntry, WorkSessionBreak } from './types';
import { formatBerlinLocalDate, getLocalDayEnd, isSameLocalDay } from '@/lib/date-time/berlin';
import { isMomentary } from './activity-intervals';
import { getEffectiveTimeEntries } from './effective-entries';
import { isBreakEndFollowedByClockIn } from './transition-pairs';
import {
  getAutomaticBreakRanges,
  type BreakDayPosition,
  type BreakPolicyValues,
  resolveBreakPolicyAtTimestamp,
  type OrganizationTimeTrackingSettings,
} from './settings';

export type CalendarBlockSegment = {
  id: string;
  type: 'work' | 'break';
  start: string;
  end: string | null;
  jobId: string | null;
};

export type CalendarWorkBlock = {
  id: string;
  userId: string;
  organizationId: string;
  jobId: string | null;
  start: string;
  end: string | null;
  startEntry: TimeEntry;
  endEntry: TimeEntry | null;
  segments: CalendarBlockSegment[];
  sourceEntries: TimeEntry[];
  isOpen: boolean;
  isOnBreak: boolean;
  isComposite: boolean;
  isPending: boolean;
  /**
   * Where the block sits in its Berlin day's presence that counts toward the
   * automatic break: the steps count the whole day, as the totals do. Absent
   * when the block is the day's only counting presence.
   */
  breakDayPosition?: BreakDayPosition;
  /**
   * The time of the day's last entry: every block of the day resolves the
   * break rule there, as the totals do. Absent: the block's own end.
   */
  breakPolicyAt?: string;
};

type OpenBlockState = {
  block: Omit<CalendarWorkBlock, 'end' | 'endEntry' | 'isOpen' | 'isOnBreak' | 'isComposite' | 'isPending'>;
  segmentType: 'work' | 'break';
  segmentStart: TimeEntry;
};

function buildSegmentId(startEntry: TimeEntry, endEntry: TimeEntry | null) {
  return `${startEntry.id}:${endEntry?.id ?? 'open'}`;
}

function cloneBlock(
  state: OpenBlockState,
  endEntry: TimeEntry | null,
  isOnBreak: boolean,
): CalendarWorkBlock {
  const isComposite =
    state.block.segments.length > 1 ||
    state.block.startEntry.entryType !== 'clock_in' ||
    (!!endEntry && endEntry.entryType !== 'clock_out');

  return {
    ...state.block,
    end: endEntry?.timestamp ?? null,
    endEntry,
    isOpen: endEntry === null,
    isOnBreak,
    isComposite,
    isPending: state.block.sourceEntries.some(
      (entry) => entry.status === 'pending' || Boolean(entry.pendingCorrectionRequestId),
    ),
  };
}

function addClosedSegment(state: OpenBlockState, endEntry: TimeEntry): OpenBlockState {
  const startMs = new Date(state.segmentStart.timestamp).getTime();
  const endMs = new Date(endEntry.timestamp).getTime();

  if (startMs >= endMs) {
    return {
      ...state,
      block: {
        ...state.block,
        sourceEntries: [...state.block.sourceEntries, endEntry],
      },
    };
  }

  return {
    ...state,
    block: {
      ...state.block,
      segments: [
        ...state.block.segments,
        {
          id: buildSegmentId(state.segmentStart, endEntry),
          type: state.segmentType,
          start: state.segmentStart.timestamp,
          end: endEntry.timestamp,
          jobId: state.block.jobId,
        },
      ],
      sourceEntries: [...state.block.sourceEntries, endEntry],
    },
  };
}

function addOpenSegment(state: OpenBlockState): OpenBlockState {
  return {
    ...state,
    block: {
      ...state.block,
      segments: [
        ...state.block.segments,
        {
          id: buildSegmentId(state.segmentStart, null),
          type: state.segmentType,
          start: state.segmentStart.timestamp,
          end: null,
          jobId: state.block.jobId,
        },
      ],
    },
  };
}

function startBlock(entry: TimeEntry, jobId: string | null): OpenBlockState {
  return {
    block: {
      id: `${entry.id}-${jobId ?? 'none'}`,
      userId: entry.userId,
      organizationId: entry.organizationId,
      jobId,
      start: entry.timestamp,
      startEntry: entry,
      segments: [],
      sourceEntries: [entry],
    },
    segmentType: 'work',
    segmentStart: entry,
  };
}

function extractBreaks(entries: TimeEntry[]): WorkSessionBreak[] {
  const breaks: WorkSessionBreak[] = [];
  let currentBreakStart: TimeEntry | null = null;

  for (const entry of entries) {
    if (entry.entryType === 'break_start') {
      currentBreakStart = entry;
      continue;
    }

    if (currentBreakStart && (entry.entryType === 'break_end' || entry.entryType === 'clock_out')) {
      breaks.push({
        breakStart: currentBreakStart,
        breakEnd: entry.entryType === 'break_end' ? entry : null,
      });
      currentBreakStart = null;
    }
  }

  if (currentBreakStart) {
    breaks.push({
      breakStart: currentBreakStart,
      breakEnd: null,
    });
  }

  return breaks;
}

function buildSyntheticBreakEntry(
  block: CalendarWorkBlock,
  entryType: 'break_start' | 'break_end',
  timestamp: Date,
  idSuffix: string,
): TimeEntry {
  return {
    id: `${block.id}-${idSuffix}`,
    userId: block.userId,
    organizationId: block.organizationId,
    entryType,
    timestamp: timestamp.toISOString(),
    isManual: false,
    jobId: block.jobId,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp.toISOString(),
    updatedAt: timestamp.toISOString(),
  };
}

/**
 * Whether a block shows the rule's automatic breaks instead of its stamped
 * ones. Under the automatic rule the totals deduct the automatic break from
 * the day's presence, stamped breaks counted as presence, and the entry
 * dialog shows the automatic breaks too; under the manual rule the stamped
 * breaks are the breaks.
 */
function showsAutomaticBreaks(policy: BreakPolicyValues | null): policy is BreakPolicyValues {
  return policy?.breakMode === 'automatic';
}

/** The first automatic break keeps the ids it had before the second step existed. */
function autoBreakId(edge: 'start' | 'end', index: number): string {
  return index === 0 ? `auto-break-${edge}` : `auto-break-${index + 1}-${edge}`;
}

function autoSegmentId(blockId: string, part: 'work-before' | 'break', index: number): string {
  return index === 0 ? `${blockId}-auto-${part}` : `${blockId}-auto-${part}-${index + 1}`;
}

function resolveDisplayBreakPolicy(
  block: CalendarWorkBlock,
  referenceDate: Date,
  settings?: OrganizationTimeTrackingSettings | null,
) {
  if (!settings) {
    return null;
  }

  return resolveBreakPolicyAtTimestamp(
    settings,
    block.breakPolicyAt ?? (block.end ? new Date(block.end) : referenceDate),
  );
}

function getCalendarBlockDisplayBreaks(
  block: CalendarWorkBlock,
  referenceDate = new Date(),
  settings?: OrganizationTimeTrackingSettings | null,
): WorkSessionBreak[] {
  const displayPolicy = resolveDisplayBreakPolicy(block, referenceDate, settings);
  if (!showsAutomaticBreaks(displayPolicy)) {
    return extractBreaks(block.sourceEntries);
  }
  const displayEnd = block.end ? new Date(block.end) : referenceDate;

  return getAutomaticBreakRanges(block.start, displayEnd, displayPolicy, block.breakDayPosition).map(
    (range, index) => ({
      breakStart: buildSyntheticBreakEntry(
        block,
        'break_start',
        range.breakStart,
        autoBreakId('start', index),
      ),
      breakEnd: buildSyntheticBreakEntry(block, 'break_end', range.breakEnd, autoBreakId('end', index)),
    }),
  );
}

/** A block's work and break segments as the day shows them, without the momentary ones. */
export function getCalendarBlockDisplaySegments(
  block: CalendarWorkBlock,
  referenceDate = new Date(),
  settings?: OrganizationTimeTrackingSettings | null,
): CalendarBlockSegment[] {
  return blockSegments(block, referenceDate, settings).filter(
    (segment) => !isMomentary(segment.start, segment.end),
  );
}

function blockSegments(
  block: CalendarWorkBlock,
  referenceDate: Date,
  settings: OrganizationTimeTrackingSettings | null | undefined,
): CalendarBlockSegment[] {
  const displayPolicy = resolveDisplayBreakPolicy(block, referenceDate, settings);
  if (!showsAutomaticBreaks(displayPolicy)) {
    return block.segments;
  }
  const displayEnd = block.end ? new Date(block.end) : referenceDate;
  const automaticBreaks = getAutomaticBreakRanges(
    block.start,
    displayEnd,
    displayPolicy,
    block.breakDayPosition,
  );

  // Without an automatic share a block keeps its own segments, unless it holds
  // a stamped break: under the automatic rule that is presence, not a break.
  if (automaticBreaks.length === 0 && extractBreaks(block.sourceEntries).length === 0) {
    return block.segments;
  }

  // Work, then each automatic break in order, then the work after the last one.
  const segments: CalendarBlockSegment[] = [];
  let workStart = new Date(block.start);
  for (const [index, automaticBreak] of automaticBreaks.entries()) {
    if (workStart < automaticBreak.breakStart) {
      segments.push({
        id: autoSegmentId(block.id, 'work-before', index),
        type: 'work',
        start: workStart.toISOString(),
        end: automaticBreak.breakStart.toISOString(),
        jobId: block.jobId,
      });
    }
    segments.push({
      id: autoSegmentId(block.id, 'break', index),
      type: 'break',
      start: automaticBreak.breakStart.toISOString(),
      end: automaticBreak.breakEnd.toISOString(),
      jobId: block.jobId,
    });
    workStart = automaticBreak.breakEnd;
  }

  if (displayEnd > workStart) {
    segments.push({
      id: `${block.id}-auto-work-after`,
      type: 'work',
      start: workStart.toISOString(),
      end: block.end,
      jobId: block.jobId,
    });
  }

  return segments;
}

function getCalendarBlockDisplayEnd(block: CalendarWorkBlock, referenceDate = new Date()): Date {
  if (block.end) {
    return new Date(block.end);
  }

  const now = referenceDate.getTime();
  const start = new Date(block.start).getTime();
  return new Date(Math.max(start, now));
}

function getCalendarBlockDurationMinutes(block: CalendarWorkBlock, referenceDate = new Date()): number {
  const startMs = new Date(block.start).getTime();
  const endMs = getCalendarBlockDisplayEnd(block, referenceDate).getTime();
  return Math.max(0, (endMs - startMs) / 60000);
}

export function createSessionFromCalendarBlock(
  block: CalendarWorkBlock,
  referenceDate = new Date(),
  settings?: OrganizationTimeTrackingSettings | null,
): InteractiveCalendarSession {
  const durationMinutes = Math.round(getCalendarBlockDurationMinutes(block, referenceDate));
  const displayPolicy = resolveDisplayBreakPolicy(block, referenceDate, settings);

  return {
    clockIn: block.startEntry,
    clockOut: block.endEntry,
    durationMinutes: block.isOpen ? null : durationMinutes,
    jobId: block.jobId,
    startEntryType: block.startEntry.entryType === 'clock_in' ? 'clock_in' : 'break_end',
    endEntryType:
      block.endEntry?.entryType === 'clock_out'
        ? 'clock_out'
        : block.endEntry?.entryType === 'break_start'
          ? 'break_start'
          : null,
    isOrphan: false,
    calendarBlockId: block.id,
    sourceEntries: block.sourceEntries,
    breaks: getCalendarBlockDisplayBreaks(block, referenceDate, settings),
    ...(displayPolicy ? { breakPolicy: displayPolicy } : {}),
    ...(block.breakDayPosition ? { breakDayPosition: block.breakDayPosition } : {}),
    isCompositeBlock: block.isComposite,
    isOnBreakBlock: block.isOnBreak,
  };
}

/** The synthetic clock_out that closes a segment still open at the end of its own Berlin day. */
function dayEndClockOut(segmentStart: TimeEntry): TimeEntry {
  return {
    ...segmentStart,
    id: `${segmentStart.id}-day-end`,
    entryType: 'clock_out',
    timestamp: getLocalDayEnd(new Date(segmentStart.timestamp)).toISOString(),
    createdAt: segmentStart.updatedAt,
    updatedAt: segmentStart.updatedAt,
  };
}

/** A person's recorded blocks; a block shorter than a minute is left out, as the day would show it as „08:15–08:15“. */
export function calculateCalendarWorkBlocks(entries: TimeEntry[]): CalendarWorkBlock[] {
  const effectiveEntries = getEffectiveTimeEntries(entries);
  const blocks: CalendarWorkBlock[] = [];
  let current: OpenBlockState | null = null;

  const closeCurrentAtBoundary = (boundaryEntry: TimeEntry) => {
    if (!current) return;
    current = addClosedSegment(current, boundaryEntry);
    blocks.push(cloneBlock(current, boundaryEntry, false));
    current = null;
  };

  for (let index = 0; index < effectiveEntries.length; index += 1) {
    const entry = effectiveEntries[index];
    if (!entry) continue;
    if (current && !isSameLocalDay(new Date(current.segmentStart.timestamp), new Date(entry.timestamp))) {
      const dayEndEntry = dayEndClockOut(current.segmentStart);

      current = addClosedSegment(current, dayEndEntry);
      blocks.push(cloneBlock(current, dayEndEntry, false));
      current = null;
    }

    switch (entry.entryType) {
      case 'clock_in':
        if (current) {
          closeCurrentAtBoundary(entry);
        }
        current = startBlock(entry, entry.jobId ?? null);
        break;
      case 'break_start':
        if (!current || current.segmentType !== 'work') {
          break;
        }
        current = addClosedSegment(current, entry);
        current = {
          ...current,
          segmentType: 'break',
          segmentStart: entry,
        };
        break;
      case 'break_end':
        if (!current || current.segmentType !== 'break') {
          break;
        }

        current = addClosedSegment(current, entry);

        if (isBreakEndFollowedByClockIn(effectiveEntries, index)) {
          blocks.push(cloneBlock(current, entry, false));
          current = null;
          break;
        }

        if ((entry.jobId ?? null) !== current.block.jobId) {
          blocks.push(cloneBlock(current, entry, false));
          current = startBlock(entry, entry.jobId ?? null);
        } else {
          current = {
            ...current,
            segmentType: 'work',
            segmentStart: entry,
          };
        }
        break;
      case 'clock_out':
        if (!current) {
          break;
        }
        current = addClosedSegment(current, entry);
        blocks.push(cloneBlock(current, entry, false));
        current = null;
        break;
    }
  }

  if (current) {
    const startDate = new Date(current.segmentStart.timestamp);
    if (isSameLocalDay(startDate, new Date())) {
      current = addOpenSegment(current);
      blocks.push(cloneBlock(current, null, current.segmentType === 'break'));
    }
  }

  return withBreakDayPositions(blocks);
}

/** Standby counts as presence but not toward the automatic break, as in the totals. */
function countsTowardBreak(block: CalendarWorkBlock): boolean {
  return block.startEntry.activityKind !== 'standby';
}

/**
 * The shown blocks, a block shorter than a minute left out, each with its
 * place in the same person's counted presence that day and the time the day's
 * rule is resolved at. The left-out blocks still count toward the steps.
 */
function withBreakDayPositions(blocks: CalendarWorkBlock[], now = Date.now()): CalendarWorkBlock[] {
  const dayOf = (block: CalendarWorkBlock) =>
    `${block.userId}:${formatBerlinLocalDate(new Date(block.start))}`;
  const countedMinutes = (block: CalendarWorkBlock) =>
    countsTowardBreak(block)
      ? Math.max(
          0,
          ((block.end ? new Date(block.end).getTime() : now) - new Date(block.start).getTime()) / 60000,
        )
      : 0;
  const isShown = (block: CalendarWorkBlock) => !isMomentary(block.start, block.end);
  type DayTotals = { shownMinutes: number; hiddenMinutes: number; lastEntryAt: string };
  const days = new Map<string, DayTotals>();
  for (const block of blocks) {
    const day = days.get(dayOf(block)) ?? { shownMinutes: 0, hiddenMinutes: 0, lastEntryAt: block.start };
    if (isShown(block)) day.shownMinutes += countedMinutes(block);
    else day.hiddenMinutes += countedMinutes(block);
    // The totals resolve the day's rule at its last entry, a break start in an open block included.
    const lastEntryAt = [
      block.end ?? block.start,
      ...block.sourceEntries.map((entry) => entry.timestamp),
    ].reduce((latest, timestamp) => (Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest));
    if (Date.parse(lastEntryAt) > Date.parse(day.lastEntryAt)) day.lastEntryAt = lastEntryAt;
    days.set(dayOf(block), day);
  }
  const beforeByDay = new Map<string, number>();
  return blocks.filter(isShown).map((block) => {
    const day = days.get(dayOf(block)) ?? { shownMinutes: 0, hiddenMinutes: 0, lastEntryAt: block.start };
    const beforeMinutes = beforeByDay.get(dayOf(block)) ?? 0;
    const ownMinutes = countedMinutes(block);
    beforeByDay.set(dayOf(block), beforeMinutes + ownMinutes);
    return {
      ...block,
      breakDayPosition: {
        countsTowardBreak: countsTowardBreak(block),
        beforeMinutes,
        afterMinutes: day.shownMinutes - beforeMinutes - ownMinutes,
        hiddenMinutes: day.hiddenMinutes,
      },
      breakPolicyAt: day.lastEntryAt,
    };
  });
}
