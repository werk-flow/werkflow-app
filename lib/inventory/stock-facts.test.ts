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

  test('a covered Verfügbar reads as the quantity', () => {
    expect(formatAvailableQuantity(1.5, 'piece')).toBe('1,5 Stück');
    expect(formatAvailableQuantity(0, 'piece')).toBe('0 Stück');
  });
});
