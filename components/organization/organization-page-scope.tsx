'use client';

import type { ReactNode } from 'react';

import { BannerScope } from '@/components/ui/banner';

/**
 * The page content of one organization. Keyed by the organization the server
 * rendered, so a switch starts every page's client state fresh exactly when the
 * new organization's server props arrive: no draft, selection or client read of
 * the previous organization survives into the next. A late answer of the
 * previous organization's page shows only a failure (`BannerScope`).
 */
export function OrganizationPageScope({
  organizationId,
  children,
}: {
  organizationId: string | null;
  children: ReactNode;
}) {
  return <BannerScope key={organizationId ?? 'none'}>{children}</BannerScope>;
}
