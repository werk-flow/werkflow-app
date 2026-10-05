import { describe, expect, test } from 'bun:test';
import { ghostPaint, ghostWidth, visibleGhostOrigin, zoneAtPoint } from './drag-ghost';

describe('ghostPaint', () => {
  test('idle without a target, whatever the last verdict said', () => {
    expect(ghostPaint(false, null)).toEqual({ state: 'idle', text: '' });
    expect(ghostPaint(false, { ok: false, message: 'Nein' })).toEqual({ state: 'idle', text: '' });
  });

  test('a refusal shows its message, a valid target its label or nothing', () => {
    expect(ghostPaint(true, { ok: false, message: 'Abwesend' })).toEqual({
      state: 'refused',
      text: 'Abwesend',
    });
    expect(ghostPaint(true, { ok: true, label: 'Anna, 08:00–10:00' })).toEqual({
      state: 'valid',
      text: 'Anna, 08:00–10:00',
    });
    expect(ghostPaint(true, { ok: true })).toEqual({ state: 'valid', text: '' });
    expect(ghostPaint(true, null)).toEqual({ state: 'refused', text: '' });
  });
});

describe('ghostWidth', () => {
  test('a message widens the ghost, the viewport caps it', () => {
    expect(ghostWidth(120, false, 1280)).toBe(120);
    expect(ghostWidth(120, true, 1280)).toBe(224);
    expect(ghostWidth(300, true, 1280)).toBe(300);
    expect(ghostWidth(300, true, 200)).toBe(184);
  });
});

describe('visibleGhostOrigin', () => {
  test('keeps the ghost eight pixels inside the viewport', () => {
    const viewport = { width: 400, height: 300 };
    const ghost = { width: 100, height: 50 };
    expect(visibleGhostOrigin({ x: 50, y: 60 }, ghost, viewport)).toEqual({ x: 50, y: 60 });
    expect(visibleGhostOrigin({ x: 390, y: 290 }, ghost, viewport)).toEqual({ x: 292, y: 242 });
    expect(visibleGhostOrigin({ x: -20, y: 2 }, ghost, viewport)).toEqual({ x: 8, y: 8 });
  });
});

describe('zoneAtPoint', () => {
  test('finds the zone under the point, edges included', () => {
    const zones = [{ zone: 'parkplatz', rect: { left: 10, right: 20, top: 10, bottom: 20 } }];
    expect(zoneAtPoint(zones, { x: 10, y: 20 })?.zone).toBe('parkplatz');
    expect(zoneAtPoint(zones, { x: 21, y: 15 })).toBeUndefined();
    expect(zoneAtPoint([], { x: 0, y: 0 })).toBeUndefined();
  });
});
