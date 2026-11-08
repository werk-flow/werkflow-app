import { expect, test } from 'bun:test';
import { isBuildable, type OrganizationExportPartView } from './view';

const failedPart = (failureReason: string): OrganizationExportPartView => ({
  id: 'part',
  partNumber: 2,
  kind: 'files',
  state: 'failed',
  fileCount: 1,
  fileBytes: 10,
  expiresAt: null,
  failureReason,
});

test('a part whose page or stored failure a new build cannot fix is not offered again', () => {
  // This page's refusal was transient, but another session stored a missing original since.
  expect(isBuildable(failedPart('storage_object_missing'), 'load_failed')).toBe(false);
  expect(isBuildable(failedPart('load_failed'), 'storage_object_missing')).toBe(false);
  expect(isBuildable(failedPart('build_failed'), 'load_failed')).toBe(true);
  expect(
    isBuildable({ ...failedPart('build_failed'), state: 'pending', failureReason: null }, undefined),
  ).toBe(true);
});
