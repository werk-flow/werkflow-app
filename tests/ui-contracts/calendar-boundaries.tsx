import { useState } from "react";
import { CalendarViewTabs } from "@/components/kalender/calendar-view-tabs";
import type { CalendarView } from "@/components/kalender/calendar-container";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { useCalendarRangeData } from "@/components/kalender/use-calendar-range-data";
import { calendarActionResult } from "@/lib/calendar/action-result";
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { getCalendarFetchRange } from "@/lib/calendar/navigation";
import { CalendarOrganizationContext, contractJob } from "./calendar-service-boundaries";
const required = ["jobs", "holidays"] as const;
const day = getCalendarFetchRange(new Date(2026, 8, 8, 12), "day");
const week = getCalendarFetchRange(new Date(2026, 8, 8, 12), "week");
function CalendarReader({ organization }: { organization: string }): React.JSX.Element {
  useRealtimeRouterRefresh({ tables: ['clients'] });
  const [needed, setNeeded] = useState(day);
  const [errors, setErrors] = useState(0);
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const [secondCompletion, setSecondCompletion] = useState<(() => void) | null>(null);
  const [transportFailure, setTransportFailure] = useState(false);
  const [completion, setCompletion] = useState<(() => void) | null>(null);
  const view = useCalendarRangeData({ organizationId: organization, identityKey: "caller:admin", needed,
    requiredDatasets: required, onReadFailed: () => setErrors((count) => count + 1) });
  return <section aria-label="Kalendervertrag">
    <output aria-label="Daten">{view.jobs.map((job) => job.title).join(",")}</output>
    <output aria-label="Betriebsruhe">{view.holidays.closureDays.map(day => day.label).join(",")}</output>
    <output aria-label="Zustand">{view.readiness.kind}</output>
    <output aria-label="Mutationen">{view.isMutating ? "aktiv" : "frei"}</output>
    <output aria-label="Transportfehler">{transportFailure ? "fehlgeschlagen" : "keiner"}</output>
    <output aria-label="Fehler">{errors}</output>
    <button onClick={() => setNeeded(week)}>Woche</button>
    <button onClick={() => setNeeded(day)}>Tag</button>
    <button disabled={pendingRefresh} onClick={async () => { setPendingRefresh(true); await view.refreshAll(); setPendingRefresh(false); }}>Aktualisieren</button>
    <button onClick={() => { const release = view.beginMutation(); view.updateJobs(() => [contractJob("optimistisch")]); setCompletion(() => release); }}>Speichern starten</button>
    <button onClick={() => completion?.()}>Speichern beenden</button>
    <button onClick={() => { const release = view.beginMutation(); setSecondCompletion(() => release); }}>Zweites Speichern starten</button>
    <button onClick={() => secondCompletion?.()}>Zweites Speichern beenden</button>
    <button onClick={async () => { const release = view.beginMutation(); try { const result = await calendarActionResult(async () => { throw new Error('held transport failure'); }); setTransportFailure(!result.success); } finally { release(); } }}>Transportfehler auslösen</button>
  </section>;
}
export function CalendarContractFixture(): React.JSX.Element {
  const [organization, setOrganization] = useState("org-a");
  const [activeView, setActiveView] = useState<CalendarView>("month");
  const [showJobs, setShowJobs] = useState(true);
  const [showWorkingHours, setShowWorkingHours] = useState(false);
  return <CalendarOrganizationContext.Provider value={organization}>
    <button onClick={() => setOrganization((old) => old === "org-a" ? "org-b" : "org-a")}>Organisation wechseln</button>
    <output aria-label="Organisation">{organization}</output>
    <CalendarViewTabs view={activeView} onViewChange={setActiveView} members={[]} selectedMemberIds={null}
      onSelectedMemberIdsChange={() => {}} isAdminOrManager={false} showWorkingHours={showWorkingHours} onShowWorkingHoursChange={setShowWorkingHours} showJobs={showJobs} onShowJobsChange={setShowJobs} />
    <RealtimeProvider><CalendarReader organization={organization} /></RealtimeProvider>
  </CalendarOrganizationContext.Provider>;
}
