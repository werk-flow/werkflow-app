import { useState } from 'react';
import { Calendar, type CalendarOptions } from '@fullcalendar/core';
import { FullCalendarView } from '@/components/kalender/fullcalendar-view';
import { getDefaultTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import { contractJob } from './calendar-service-boundaries';

// Count calls at the actual FullCalendar API boundary without replacing their implementations.
declare global { interface Window { monthViewContract: { gotoDate: number; changeView: number; resetOptions: number; eventSources: number; presentationChanges: number }; } }
window.monthViewContract = { gotoDate: 0, changeView: 0, resetOptions: 0, eventSources: 0, presentationChanges: 0 };
const originalGotoDate = Calendar.prototype.gotoDate;
const originalChangeView = Calendar.prototype.changeView;
const originalResetOptions = Calendar.prototype.resetOptions;
Calendar.prototype.gotoDate = function (...args: Parameters<Calendar['gotoDate']>) { window.monthViewContract.gotoDate += 1; return originalGotoDate.apply(this, args); };
Calendar.prototype.changeView = function (...args: Parameters<Calendar['changeView']>) { window.monthViewContract.changeView += 1; return originalChangeView.apply(this, args); };
let previousOptions: CalendarOptions | undefined;
Calendar.prototype.resetOptions = function (...args: Parameters<Calendar['resetOptions']>) {
  window.monthViewContract.resetOptions += 1;
  if (args[0].events !== this.getOption('events')) window.monthViewContract.eventSources += 1;
  if (previousOptions) {
    for (const name of ['slotLabelFormat', 'eventTimeFormat', 'dayHeaderFormat', 'moreLinkContent'] as const) {
      if (args[0][name] !== previousOptions[name]) window.monthViewContract.presentationChanges += 1;
    }
  }
  previousOptions = args[0];
  return originalResetOptions.apply(this, args);
};
const initialDate = new Date(2026, 5, 15, 12);
const nextDate = new Date(2026, 6, 15, 12);
const entries: [] = [];
const members: [] = [];
const settings = getDefaultTimeTrackingSettings('org');
const initialJob = { ...contractJob('Monatsauftrag'), plannedDate: '2026-06-15', plannedTime: '09:00', estimatedDurationMinutes: 60 };
const initialJobs = [initialJob];
const nextJobs = [{ ...initialJob, plannedDate: '2026-07-15', title: 'Aktualisierter Monatsauftrag' }];
const initialHolidays: OrganizationHolidayCalendar = { holidayRegion: 'BY', holidayRegionHistory: [], closureDays: [] };
const noOperation = () => {};
export function MonthViewContractFixture(): React.JSX.Element {
  const [date, setDate] = useState(initialDate);
  const [jobs, setJobs] = useState(initialJobs);
  const [holidays, setHolidays] = useState(initialHolidays);
  const [ready, setReady] = useState<string | null>(null);
  const [parentRevision, setParentRevision] = useState(0);
  return <section aria-label="Monatskalender">
    <output aria-label="Gerenderter Tag">{ready ?? 'lädt'}</output>
    <output aria-label="Äußerer Zustand">{parentRevision}</output>
    <button onClick={() => setParentRevision(value => value + 1)}>Äußeren Zustand ändern</button>
    <button onClick={() => setDate(nextDate)}>Nächsten Monat anzeigen</button>
    <button onClick={() => setJobs(nextJobs)}>Neue Aufträge übernehmen</button>
    <button onClick={() => setHolidays({ ...initialHolidays, closureDays: [{ closureDate: '2026-07-15', label: 'Betriebsruhe Test' }] })}>Betriebsruhe übernehmen</button>
    <button onClick={() => setDate(new Date(2027, 0, 1, 12))}>Nächstes Jahr anzeigen</button>
    <div style={{ height: 500, width: 1000 }}><FullCalendarView date={date} view="month" entries={entries} members={members} organizationSettings={settings} holidayCalendar={holidays} vacationEntries={entries} sicknessEntries={entries} currentUserId="manager" isAdminOrManager onEventClick={noOperation} onDateSelect={noOperation} onViewChange={noOperation} onRendererReady={setReady} jobs={jobs} /></div>
  </section>;
}
