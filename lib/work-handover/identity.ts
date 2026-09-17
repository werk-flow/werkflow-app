import { createHash } from 'node:crypto';

import type { WorkTargetType } from '@/lib/work-lifecycle/types';

export function deterministicWorkHandoverUuid(...parts: string[]): string {
  const hash = createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
  // Digit 12 carries the UUID version, digit 16 the RFC 4122 variant.
  const variantDigit = '89ab'.charAt(Number.parseInt(hash.charAt(16), 16) % 4);
  const value = `${hash.slice(0, 12)}5${hash.slice(13, 16)}${variantDigit}${hash.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function workHandoverPackageId(
  organizationId: string,
  targetType: WorkTargetType,
  targetId: string
): string {
  return deterministicWorkHandoverUuid(
    'work-handover-package', organizationId, targetType, targetId
  );
}
