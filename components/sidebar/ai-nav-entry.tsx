import { Sparkles } from 'lucide-react';

import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import type { ServerNavEntry } from './app-shell';

/**
 * WerkFlow KI's sidebar entry for the member's released organizations. The
 * app layout renders it on the server, so an organization WerkFlow has not
 * released WerkFlow KI to loads none of its label, icon or route
 * (werk-flow/werkflow-planning#530).
 */
export function aiNavEntry(organizationIds: readonly string[]): ServerNavEntry {
  return {
    href: '/ki',
    label: AI_PRODUCT_NAME,
    icon: <Sparkles className="size-4" />,
    organizationIds,
  };
}
