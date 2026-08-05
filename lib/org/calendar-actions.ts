'use server';

import { updateTag } from 'next/cache';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isHolidayRegion } from '@/lib/personnel/holidays';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import {
  parseHolidayRegionHistory,
  type HolidayRegionHistoryEntry,
} from '@/lib/personnel/targets';

// Organization holiday/closure configuration (P1-04).
// - Holiday region: admin-only (structural policy, break-settings precedent),
//   recorded with an effective-from history so historical days keep the region
//   effective then. Selecting a region never applies holidays retroactively.
// - Closure days (Betriebsruhe): admin + Büro (operational planning), only for
//   today/future dates so past targets are never silently rewritten.

export type CalendarActionResult =
  | { success: true }
  | { success: false; error: string };

export async function setHolidayRegion(
  region: string | null
): Promise<CalendarActionResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;

    if (region !== null && !isHolidayRegion(region)) {
      return { success: false, error: 'invalid_region' };
    }

    const admin = createSupabaseAdminClient();
    const { data: organization, error: orgError } = await admin
      .from('organizations')
      .select('id, admin_id')
      .eq('id', orgId)
      .single();

    if (orgError || !organization) {
      return { success: false, error: 'org_not_found' };
    }
    if (organization.admin_id !== userId) {
      return { success: false, error: 'not_authorized' };
    }

    // Append onto the stored history, never onto the cross-request cache: a
    // stale cached copy could silently drop earlier history entries and with
    // them the effective-dated meaning of past days.
    const { data: settingsRow, error: settingsError } = await admin
      .from('organization_settings')
      .select('holiday_region, holiday_region_history')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (settingsError) {
      console.error('Failed to read holiday settings:', settingsError);
      return { success: false, error: 'update_failed' };
    }

    if ((settingsRow?.holiday_region ?? null) === region) {
      return { success: true };
    }

    const nextEntry: HolidayRegionHistoryEntry = {
      // Empty string marks an explicit deselection in the history.
      region: region ?? '',
      effectiveFrom: new Date().toISOString(),
    };
    const nextHistory = [
      ...parseHolidayRegionHistory(settingsRow?.holiday_region_history),
      nextEntry,
    ];

    const { error: updateError } = await admin
      .from('organization_settings')
      .upsert(
        {
          organization_id: orgId,
          holiday_region: region,
          holiday_region_history: nextHistory,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' }
      );

    if (updateError) {
      console.error('Failed to update holiday region:', updateError);
      return { success: false, error: 'update_failed' };
    }

    updateTag(CACHE_TAGS.organizationSettings(orgId));
    updateTag(CACHE_TAGS.organizationCalendar(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in setHolidayRegion:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function addClosureDay(input: {
  closureDate: string;
  label?: string | null;
}): Promise<CalendarActionResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    if (
      !ISO_DATE_PATTERN.test(input.closureDate) ||
      Number.isNaN(Date.parse(input.closureDate))
    ) {
      return { success: false, error: 'invalid_date' };
    }

    // V1 rule: no past dates — a historical day's target must never be
    // silently rewritten by adding a closure day after the fact.
    if (input.closureDate < getBusinessTodayIso()) {
      return { success: false, error: 'date_in_past' };
    }

    const label = input.label?.trim();
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('organization_closure_days').insert({
      organization_id: orgId,
      closure_date: input.closureDate,
      label: label && label.length > 0 ? label : null,
      created_by: userId,
    });

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'duplicate_date' };
      }
      console.error('Failed to add closure day:', error);
      return { success: false, error: 'create_failed' };
    }

    updateTag(CACHE_TAGS.organizationCalendar(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in addClosureDay:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function removeClosureDay(
  closureDayId: string
): Promise<CalendarActionResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const { data: closureDay, error: loadError } = await admin
      .from('organization_closure_days')
      .select('id, closure_date')
      .eq('id', closureDayId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (loadError || !closureDay) {
      return { success: false, error: 'closure_day_not_found' };
    }

    // Same historical-meaning rule as adding: past closure days stay.
    if (closureDay.closure_date < getBusinessTodayIso()) {
      return { success: false, error: 'date_in_past' };
    }

    const { error } = await admin
      .from('organization_closure_days')
      .delete()
      .eq('id', closureDayId)
      .eq('organization_id', orgId);

    if (error) {
      console.error('Failed to remove closure day:', error);
      return { success: false, error: 'delete_failed' };
    }

    updateTag(CACHE_TAGS.organizationCalendar(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in removeClosureDay:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
