import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { parseHolidayRegionHistory, type OrganizationHolidayCalendar } from './targets';

/** Internal reader: the caller establishes current organization permission first. */
export async function readOrganizationCalendar(organizationId: string, dates?: { from: string; to: string }): Promise<OrganizationHolidayCalendar> {
  const admin = createSupabaseAdminClient();
  const [settings, closures] = await Promise.all([
    admin.from('organization_settings').select('holiday_region, holiday_region_history').eq('organization_id', organizationId).maybeSingle(),
    readCompleteRows((from, to) => {
      let query = admin.from('organization_closure_days').select('id, closure_date, label').eq('organization_id', organizationId);
      if (dates) query = query.gte('closure_date', dates.from).lte('closure_date', dates.to);
      return query.order('closure_date', { ascending: true }).range(from, to);
    }, LIST_ROW_CAP),
  ]);
  // A failed read cannot claim there are no closure days.
  if (settings.error || closures.error) throw new Error('organization_calendar_read_failed');
  return {
    holidayRegion: settings.data?.holiday_region ?? null,
    holidayRegionHistory: parseHolidayRegionHistory(settings.data?.holiday_region_history),
    closureDays: closures.data.map(row => ({ id: row.id, closureDate: row.closure_date, label: row.label })),
  };
}
