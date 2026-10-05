import { describe, expect, test } from 'bun:test';
import { isManagerRole } from './roles';

describe('isManagerRole', () => {
  test('admin and Büro manage other members; an employee does not', () => {
    expect(isManagerRole('admin')).toBe(true);
    expect(isManagerRole('buero')).toBe(true);
    expect(isManagerRole('employee')).toBe(false);
  });
});
