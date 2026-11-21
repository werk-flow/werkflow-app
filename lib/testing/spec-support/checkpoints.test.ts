import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCheckpoint, writeCheckpoint } from './checkpoints';
import { temporaryDirectory } from '../temporary-directory';

const layoutDetails = {
  clientId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  projectNumber: 'PRJ-1',
  jobId: '44444444-4444-4444-8444-444444444444',
  jobNumber: 'AUF-1',
  nestedJobNumber: 'AUF-1-1',
  equipmentNumber: 'ANL-1',
  caseNumber: 'SF-1',
  offerId: '00000000-0000-4000-8000-000000000009',
  invoiceId: '00000000-0000-4000-8000-00000000000a',
};

function temporaryPath(): string {
  const directory = temporaryDirectory('werkflow-checkpoint-');
  return join(directory, 'checkpoints.json');
}

test('recovers an exact persisted value without process memory', () => {
  const path = temporaryPath();
  writeCheckpoint(path, 'world-one', 'layout.details', layoutDetails);
  expect(readCheckpoint(path, 'world-one', 'layout.details')).toEqual(layoutDetails);
  expect(readCheckpoint(temporaryPath(), 'world-one', 'layout.details')).toBeUndefined();
});

test('refuses checkpoint reuse across disposable worlds', () => {
  const path = temporaryPath();
  writeCheckpoint(path, 'original', 'layout.details', layoutDetails);
  expect(() => readCheckpoint(path, 'other', 'layout.details')).toThrow('different test world');
  expect(() => writeCheckpoint(path, 'other', 'layout.details', layoutDetails)).toThrow(
    'different test world',
  );
});

test('does not treat corrupted checkpoint data as missing setup', () => {
  const path = temporaryPath();
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      worldRunId: 'world',
      values: { 'layout.details': { ...layoutDetails, clientId: 'not-a-uuid' } },
    }),
  );
  expect(() => readCheckpoint(path, 'world', 'layout.details')).toThrow();
});
