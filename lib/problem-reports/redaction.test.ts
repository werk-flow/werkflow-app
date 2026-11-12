import { expect, test } from 'bun:test';
import { boxFromDrag, imagePoint } from './redaction';

test('a drag spans the same box whichever corner it starts at', () => {
  const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  const fromTopLeft = boxFromDrag({ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 });
  const fromBottomRight = boxFromDrag({ x: 0.4, y: 0.6 }, { x: 0.1, y: 0.2 });
  for (const drawn of [fromTopLeft, fromBottomRight]) {
    expect(drawn?.x).toBeCloseTo(box.x);
    expect(drawn?.y).toBeCloseTo(box.y);
    expect(drawn?.width).toBeCloseTo(box.width);
    expect(drawn?.height).toBeCloseTo(box.height);
  }
});

test('a tap draws no box', () => {
  expect(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.6 })).toBeNull();
});

test('a pointer outside the preview clamps to its edge', () => {
  const preview = { left: 100, top: 50, width: 200, height: 100 };
  expect(imagePoint({ x: 50, y: 400 }, preview)).toEqual({ x: 0, y: 1 });
  expect(imagePoint({ x: 200, y: 100 }, preview)).toEqual({ x: 0.5, y: 0.5 });
});
