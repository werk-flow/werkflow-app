import { describe, expect, test } from 'bun:test';
import { bueroMayManage, isManagerRole } from './roles';

describe('isManagerRole', () => {
  test('admin and Büro manage other members; an employee does not', () => {
    expect(isManagerRole('admin')).toBe(true);
    expect(isManagerRole('buero')).toBe(true);
    expect(isManagerRole('employee')).toBe(false);
  });
});

describe('bueroMayManage', () => {
  test('a Büro member manages employees only, and never a role this build does not know', () => {
    expect(bueroMayManage('employee')).toBe(true);
    expect(bueroMayManage('buero')).toBe(false);
    expect(bueroMayManage('admin')).toBe(false);
    // A newer release may add a role; until this build knows it, the guard fails closed.
    expect(bueroMayManage('projektleitung')).toBe(false);
  });
});
