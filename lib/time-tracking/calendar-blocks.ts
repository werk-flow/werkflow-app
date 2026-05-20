import type {
  InteractiveCalendarSession,
  TimeEntry,
  WorkSessionBreak
} from './types';
import { getLocalDayEnd, isSameLocalDay } from './day-utils';
import { getEffectiveTimeEntries } from './effective-entries';
import { isBreakEndFollowedByClockIn } from './transition-pairs';
import {
  getAutomaticBreakRange,
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
};

type OpenBlockState = {
  block: Omit<
    CalendarWorkBlock,
    'end' | 'endEntry' | 'isOpen' | 'isOnBreak' | 'isComposite' | 'isPending'
  >;
  segmentType: 'work' | 'break';
  segmentStart: TimeEntry;
};

function buildSegmentId(startEntry: TimeEntry, endEntry: TimeEntry | null) {
  return `${startEntry.id}:${endEntry?.id ?? 'open'}`;
}

function cloneBlock(
  state: OpenBlockState,
  endEntry: TimeEntry | null,
  isOnBreak: boolean
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
    isPending: state.block.sourceEntries.some((entry) => entry.status === 'pending')
  };
}

function addClosedSegment(
  state: OpenBlockState,
  endEntry: TimeEntry
): OpenBlockState {
  const startMs = new Date(state.segmentStart.timestamp).getTime();
  const endMs = new Date(endEntry.timestamp).getTime();

  if (startMs >= endMs) {
    return {
      ...state,
      block: {
        ...state.block,
        sourceEntries: [...state.block.sourceEntries, endEntry]
      }
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
          jobId: state.block.jobId
        }
      ],
      sourceEntries: [...state.block.sourceEntries, endEntry]
    }
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
          jobId: state.block.jobId
        }
      ]
    }
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
      sourceEntries: [entry]
    },
    segmentType: 'work',
    segmentStart: entry
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

    if (
      currentBreakStart &&
      (entry.entryType === 'break_end' || entry.entryType === 'clock_out')
    ) {
      breaks.push({
        breakStart: currentBreakStart,
        breakEnd: entry.entryType === 'break_end' ? entry : null
      });
      currentBreakStart = null;
    }
  }

  if (currentBreakStart) {
    breaks.push({
      breakStart: currentBreakStart,
      breakEnd: null
    });
  }

  return breaks;
}

function buildSyntheticBreakEntry(
  block: CalendarWorkBlock,
  entryType: 'break_start' | 'break_end',
  timestamp: Date,
  idSuffix: string
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

function resolveDisplayBreakPolicy(
  block: CalendarWorkBlock,
  referenceDate: Date,
  settings?: OrganizationTimeTrackingSettings | null
) {
  if (!settings) {
    return null
  }

  return resolveBreakPolicyAtTimestamp(
    settings,
    block.end ? new Date(block.end) : referenceDate
  )
}

export function getCalendarBlockDisplayBreaks(
  block: CalendarWorkBlock,
  referenceDate = new Date(),
  settings?: OrganizationTimeTrackingSettings | null
): WorkSessionBreak[] {
  const actualBreaks = extractBreaks(block.sourceEntries)
  if (actualBreaks.length > 0) {
    return actualBreaks
  }

  const displayPolicy = resolveDisplayBreakPolicy(block, referenceDate, settings)
  const displayEnd = block.end ? new Date(block.end) : referenceDate
  const automaticBreak = getAutomaticBreakRange(block.start, displayEnd, displayPolicy)

  if (!automaticBreak) {
    return []
  }

  const breakStartEntry = buildSyntheticBreakEntry(
    block,
    'break_start',
    automaticBreak.breakStart,
    'auto-break-start'
  )
  const breakEndEntry = buildSyntheticBreakEntry(
    block,
    'break_end',
    automaticBreak.breakEnd,
    'auto-break-end'
  )

  return [{ breakStart: breakStartEntry, breakEnd: breakEndEntry }]
}

export function getCalendarBlockDisplaySegments(
  block: CalendarWorkBlock,
  referenceDate = new Date(),
  settings?: OrganizationTimeTrackingSettings | null
): CalendarBlockSegment[] {
  const actualBreaks = extractBreaks(block.sourceEntries)
  if (actualBreaks.length > 0) {
    return block.segments
  }

  const displayPolicy = resolveDisplayBreakPolicy(block, referenceDate, settings)
  const displayEnd = block.end ? new Date(block.end) : referenceDate
  const automaticBreak = getAutomaticBreakRange(block.start, displayEnd, displayPolicy)

  if (!automaticBreak) {
    return block.segments
  }

  const blockStart = new Date(block.start)
  const segments: CalendarBlockSegment[] = []

  if (blockStart < automaticBreak.breakStart) {
    segments.push({
      id: `${block.id}-auto-work-before`,
      type: 'work',
      start: block.start,
      end: automaticBreak.breakStart.toISOString(),
      jobId: block.jobId,
    })
  }

  segments.push({
    id: `${block.id}-auto-break`,
    type: 'break',
    start: automaticBreak.breakStart.toISOString(),
    end: automaticBreak.breakEnd.toISOString(),
    jobId: block.jobId,
  })

  if (displayEnd > automaticBreak.breakEnd) {
    segments.push({
      id: `${block.id}-auto-work-after`,
      type: 'work',
      start: automaticBreak.breakEnd.toISOString(),
      end: block.end,
      jobId: block.jobId,
    })
  }

  return segments
}

export function getCalendarBlockDisplayEnd(
  block: CalendarWorkBlock,
  referenceDate = new Date()
): Date {
  if (block.end) {
    return new Date(block.end);
  }

  const now = referenceDate.getTime();
  const start = new Date(block.start).getTime();
  return new Date(Math.max(start, now));
}

export function getCalendarBlockDurationMinutes(
  block: CalendarWorkBlock,
  referenceDate = new Date()
): number {
  const startMs = new Date(block.start).getTime();
  const endMs = getCalendarBlockDisplayEnd(block, referenceDate).getTime();
  return Math.max(0, (endMs - startMs) / 60000);
}

export function createSessionFromCalendarBlock(
  block: CalendarWorkBlock,
  referenceDate = new Date(),
  settings?: OrganizationTimeTrackingSettings | null
): InteractiveCalendarSession {
  const durationMinutes = Math.round(
    getCalendarBlockDurationMinutes(block, referenceDate)
  );
  const displayPolicy = resolveDisplayBreakPolicy(block, referenceDate, settings)

  return {
    clockIn: block.startEntry,
    clockOut: block.endEntry,
    durationMinutes: block.isOpen ? null : durationMinutes,
    jobId: block.jobId,
    startEntryType:
      block.startEntry.entryType === 'clock_in' ? 'clock_in' : 'break_end',
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
    breakMode: displayPolicy?.breakMode,
    autoBreakThresholdMinutes: displayPolicy?.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: displayPolicy?.autoBreakDurationMinutes,
    isCompositeBlock: block.isComposite,
    isOnBreakBlock: block.isOnBreak
  };
}

export function calculateCalendarWorkBlocks(
  entries: TimeEntry[]
): CalendarWorkBlock[] {
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
    if (
      current &&
      !isSameLocalDay(new Date(current.segmentStart.timestamp), new Date(entry.timestamp))
    ) {
      const dayEndEntry: TimeEntry = {
        ...current.segmentStart,
        id: `${current.segmentStart.id}-day-end`,
        entryType: 'clock_out',
        timestamp: getLocalDayEnd(new Date(current.segmentStart.timestamp)).toISOString(),
        createdAt: current.segmentStart.updatedAt,
        updatedAt: current.segmentStart.updatedAt
      };

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
          segmentStart: entry
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
            segmentStart: entry
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
    current = addOpenSegment(current);
    blocks.push(cloneBlock(current, null, current.segmentType === 'break'));
  }

  return blocks;
}
