import { describe, expect, test } from 'bun:test';
import {
  autoScrollVelocity,
  exceedsDragThreshold,
  formatMinutesOfDay,
  indexAtOffset,
  measuredTrackStarts,
  minutesToPixels,
  pixelsToMinutes,
  snapMinutes,
  uniformTrackStarts,
} from './drag-math';

describe('drag math', () => {
  test('resolves track indices from cumulative starts and reports outside positions as null', () => {
    const starts = measuredTrackStarts([80, 120, 60], 10);
    expect(starts).toEqual([10, 90, 210, 270]);
    expect(indexAtOffset(starts, 10)).toBe(0);
    expect(indexAtOffset(starts, 89.9)).toBe(0);
    expect(indexAtOffset(starts, 90)).toBe(1);
    expect(indexAtOffset(starts, 269)).toBe(2);
    expect(indexAtOffset(starts, 270)).toBeNull();
    expect(indexAtOffset(starts, 5)).toBeNull();
    expect(indexAtOffset([], 5)).toBeNull();
    expect(uniformTrackStarts(3, 100, 160)).toEqual([160, 260, 360, 460]);
    expect(indexAtOffset(uniformTrackStarts(7, 100), 650)).toBe(6);
  });

  test('snaps minutes to the step inside the day and converts pixels', () => {
    expect(snapMinutes(37, 15)).toBe(30);
    expect(snapMinutes(38, 15)).toBe(45);
    expect(snapMinutes(38, 5)).toBe(40);
    expect(snapMinutes(1_500, 15)).toBe(1_440);
    expect(pixelsToMinutes(90, 60)).toBe(90);
    expect(minutesToPixels(90, 60)).toBe(90);
    expect(formatMinutesOfDay(555)).toBe('09:15');
    expect(formatMinutesOfDay(1_440)).toBe('24:00');
  });

  test('auto-scroll grows toward the edges and stays zero in the middle or in tiny containers', () => {
    expect(autoScrollVelocity(500, 0, 1000)).toBe(0);
    expect(autoScrollVelocity(0, 0, 1000)).toBe(-24);
    expect(autoScrollVelocity(20, 0, 1000)).toBe(-12);
    expect(autoScrollVelocity(1000, 0, 1000)).toBe(24);
    expect(autoScrollVelocity(10, 0, 60)).toBe(0);
  });

  test('applies the five pixel threshold on the distance, not per axis', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(true);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
  });
});
