export const LIST_PAGE_SIZE = 50;

export function parseListPage(value: string | number | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1;
}

export function lastListPage(total: number, pageSize = LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
