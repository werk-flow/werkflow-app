import { describe, expect, test } from 'bun:test';
import { formatAvailableQuantity, inventoryStockFacts } from './stock-facts';

const tracked = { trackQuantity: true, globalMinimumStock: 0 };

describe('inventoryStockFacts', () => {
  test('Verfügbar keeps its sign when planned demand exceeds the stock', () => {
    expect(inventoryStockFacts(tracked, 3, 5).availableQuantity).toBe(-2);
    expect(inventoryStockFacts(tracked, 3, 1).availableQuantity).toBe(2);
  });

  test('planned demand above the stock is a shortfall, never „Auf Lager“', () => {
    expect(inventoryStockFacts(tracked, 3, 4).stockStatus).toBe('shortfall');
  });

  test('a shortfall outranks empty and low stock', () => {
    expect(inventoryStockFacts(tracked, 0, 2).stockStatus).toBe('shortfall');
    expect(inventoryStockFacts({ trackQuantity: true, globalMinimumStock: 5 }, 2, 3).stockStatus).toBe(
      'shortfall',
    );
  });

  test('decimal quantities compare as the database stores them, so rows agree with the SQL status', () => {
    expect(inventoryStockFacts(tracked, 0.3, 0.1 + 0.2)).toEqual({
      availableQuantity: 0,
      stockStatus: 'in_stock',
    });
    expect(
      inventoryStockFacts({ trackQuantity: true, globalMinimumStock: 0.3 }, 0.1 + 0.2, 0).stockStatus,
    ).toBe('low_stock');
    expect(
      formatAvailableQuantity(inventoryStockFacts(tracked, 0.3, 0.1 + 0.2).availableQuantity, 'meter'),
    ).toBe('0 Meter');
  });

  test('demand the stock covers keeps the stock status', () => {
    expect(inventoryStockFacts(tracked, 3, 3).stockStatus).toBe('in_stock');
    expect(inventoryStockFacts(tracked, 0, 0).stockStatus).toBe('out_of_stock');
    expect(inventoryStockFacts({ trackQuantity: true, globalMinimumStock: 5 }, 4, 1).stockStatus).toBe(
      'low_stock',
    );
  });
});

describe('formatAvailableQuantity', () => {
  test('a negative Verfügbar reads as the missing quantity', () => {
    expect(formatAvailableQuantity(-2, 'piece')).toBe('Fehlmenge 2 Stück');
  });

  test('the smallest stored shortfall still reads as a shortfall', () => {
    const { availableQuantity, stockStatus } = inventoryStockFacts(tracked, 0.3, 0.301);
    expect(stockStatus).toBe('shortfall');
    expect(formatAvailableQuantity(availableQuantity, 'meter')).toBe('Fehlmenge 0,001 Meter');
  });

  test('a covered Verfügbar reads as the quantity', () => {
    expect(formatAvailableQuantity(1.5, 'piece')).toBe('1,5 Stück');
    expect(formatAvailableQuantity(0, 'piece')).toBe('0 Stück');
  });
});

test('an item without tracked stock never shows a shortfall', () => {
  const untracked = { trackQuantity: false, globalMinimumStock: 0 };
  // No stock rows and 4 planned: neither „Fehlmenge“ nor „Unterdeckt“.
  expect(inventoryStockFacts(untracked, 0, 4)).toEqual({ availableQuantity: 0, stockStatus: 'in_stock' });
  expect(
    formatAvailableQuantity(inventoryStockFacts(untracked, 0, 4).availableQuantity, 'piece'),
  ).not.toContain('Fehlmenge');
});
