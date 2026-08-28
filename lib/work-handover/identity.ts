import { createHash } from 'node:crypto';

import type { WorkTargetType } from '@/lib/work-lifecycle/types';

export function deterministicWorkHandoverUuid(...parts: string[]): string {
  const hash = createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
  const hexDigits = hash.slice(0, 32).split('');
  hexDigits[12] = '5';
  hexDigits[16] = ['8', '9', 'a', 'b'][Number.parseInt(hexDigits[16], 16) % 4];
  const value = hexDigits.join('');
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
