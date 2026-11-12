'use client';

import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';

const SIGNAL_TABLES = ['problem_report_signals'] as const;

/**
 * Keeps a page of problem reports live. A change for this person touches
 * their own signal row, which carries no report content and which only they
 * may read, and the route reads its reports again through the server: in
 * „Meine Meldungen“ when support changes a status or an answer or files a
 * report for the person, in support's area when another support person
 * triages, opens an original or files a report.
 */
export function ProblemReportSignalsLive(): null {
  useRealtimeRouterRefresh({ tables: SIGNAL_TABLES });
  return null;
}
