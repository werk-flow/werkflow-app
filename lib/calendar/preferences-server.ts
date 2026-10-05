import 'server-only';

import { cache } from 'react';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCalendarPreferences, type CalendarPreferences } from './preferences';

/** The page supplies its verified caller scope. Share reads within a render, never across requests. */
export const getCalendarPreferencesForPage = cache(
  async (organizationId: string, userId: string): Promise<CalendarPreferences> => {
    const { data, error } = await createSupabaseAdminClient()
      .from('organization_user_preferences')
      .select('preferences')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    // A failed read must not replace saved choices with defaults.
    if (error) throw new Error(`Calendar preferences could not be read (code=${error.code}).`);
    return readCalendarPreferences(data?.preferences);
  },
);
