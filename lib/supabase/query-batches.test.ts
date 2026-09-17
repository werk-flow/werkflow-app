import { expect, test } from "bun:test";

import { readCompleteRows, BATCH_CONCURRENCY, chunkIds, ID_BATCH_SIZE, readAllRows, readInBatches, ROW_PAGE_SIZE } from "./query-batches";

test("ids are deduplicated and chunked below the gateway's query-string limit", () => {
  const ids = Array.from({ length: 360 }, (_, index) => `id-${index % 250}`);
  const chunks = chunkIds(ids);
  expect(chunks).toHaveLength(3);
  expect(chunks.flat()).toHaveLength(250);
  expect(chunks.every((chunk) => chunk.length <= ID_BATCH_SIZE)).toBe(true);
  expect(chunkIds([])).toEqual([]);
  expect(() => chunkIds(["a"], 0)).toThrow();
});

test("batched reads concatenate rows and keep the first error", async () => {
  const calls: number[] = [];
  const ok = await readInBatches(Array.from({ length: 205 }, (_, index) => `id-${index}`), async (batch) => {
    calls.push(batch.length);
    return { data: batch.map((id) => ({ id })), error: null };
  });
  expect(calls).toEqual([100, 100, 5]);
  expect(ok.data).toHaveLength(205);
  expect(ok.error).toBeNull();

  const failed = await readInBatches(["a", "b"], async (batch) =>
    batch[0] === "b" ? { data: null, error: { message: "URI too long" } } : { data: [{ id: "a" }], error: null }, 1);
  expect(failed).toEqual({ data: [], error: { message: "URI too long" } });
});

test("batched reads keep at most BATCH_CONCURRENCY requests in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  const ids = Array.from({ length: 2_500 }, (_, index) => `id-${index}`);
  const result = await readInBatches(ids, async (batch) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return { data: batch.map((id) => ({ id })), error: null };
  });
  expect(result.data.map((row) => row.id)).toEqual(ids);
  expect(peak).toBe(BATCH_CONCURRENCY);
});

test("complete reads page at the response cap and stop at the first short page", async () => {
  const total = 2_500;
  const pages: Array<[number, number]> = [];
  const result = await readAllRows(async (from, to) => {
    pages.push([from, to]);
    return { data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, index) => ({ id: from + index })), error: null };
  }, { cap: 5_000 });
  expect(pages).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  expect(result.data).toHaveLength(total);
  expect(result.overflow).toBe(false);
});

test("a complete read reports overflow instead of silently truncating, and keeps the first error", async () => {
  const overflow = await readAllRows(async (from) => ({ data: Array.from({ length: ROW_PAGE_SIZE }, (_, index) => ({ id: from + index })), error: null }), { cap: 2_000 });
  expect(overflow).toEqual({ data: [], error: null, overflow: true });
  const failed = await readAllRows(async () => ({ data: null, error: { message: "boom" } }), { cap: 10 });
  expect(failed).toEqual({ data: [], error: { message: "boom" }, overflow: false });
  await expect(readAllRows(async () => ({ data: [], error: null }), { cap: 0 })).rejects.toThrow();
});

test('complete readers expose overflow as failure instead of returning a partial set', async () => {
  const rows=Array.from({length:1105},(_,id)=>({id}));
  const read=(from:number,to:number)=>Promise.resolve({data:rows.slice(from,to+1),error:null});
  const complete=await readCompleteRows(read,1200);
  expect(complete.data).toHaveLength(1105); expect(complete.error).toBeNull();
  const overflow=await readCompleteRows(read,1000);
  expect(overflow.data).toEqual([]); expect(overflow.error).toMatchObject({ code: 'row_overflow' });
});
