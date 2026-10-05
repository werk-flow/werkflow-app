import { describe, expect, test } from 'bun:test';
import { dayMinutesAtPoint, edgeResizedSpan } from './day-drag-geometry';

describe('dayMinutesAtPoint', () => {
  const axis = { timelineLeft: 200, hourWidth: 120, scrollDelta: 0, fine: false };

  test('snaps to quarter hours, or five minutes with the fine modifier', () => {
    expect(dayMinutesAtPoint({ ...axis, x: 200 + 120 * 8 + 20 })).toBe(8 * 60 + 15);
    expect(dayMinutesAtPoint({ ...axis, x: 200 + 120 * 8 + 20, fine: true })).toBe(8 * 60 + 10);
  });

  test('adds the scroll since measuring and stays inside the day', () => {
    expect(dayMinutesAtPoint({ ...axis, x: 200, scrollDelta: 240 })).toBe(120);
    expect(dayMinutesAtPoint({ ...axis, x: 100 })).toBe(0);
    expect(dayMinutesAtPoint({ ...axis, x: 200 + 120 * 30 })).toBe(24 * 60);
  });
});

describe('edgeResizedSpan', () => {
  const span = { start: 480, end: 600, minimumLength: 15 };

  test('the dragged edge follows, the other stays', () => {
    expect(edgeResizedSpan({ ...span, edge: 'start', edgeAt: 450 })).toEqual({ start: 450, end: 600 });
    expect(edgeResizedSpan({ ...span, edge: 'end', edgeAt: 660 })).toEqual({ start: 480, end: 660 });
  });

  test('the span never closes below the minimum length', () => {
    expect(edgeResizedSpan({ ...span, edge: 'start', edgeAt: 700 })).toEqual({ start: 585, end: 600 });
    expect(edgeResizedSpan({ ...span, edge: 'end', edgeAt: 300 })).toEqual({ start: 480, end: 495 });
  });
});
