import { RouteRefreshFixture } from './route-refresh-boundaries';
import { CustomerContractFixture } from './customer-boundaries';
import { ClockContractFixture } from './clock-boundaries';
import { SidebarContractFixture } from './sidebar-boundaries';
import { CalendarBoardContractFixture, CalendarDayContractFixture, CalendarMonthContractFixture } from './calendar-views-boundaries';
import { OptionContractFixture } from './option-boundaries';
import { ListNavigationFixture } from './list-navigation-boundaries';
import { OrganizationContractFixture } from './organization-boundaries';
import { CalendarContractFixture } from "./calendar-boundaries";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { BannerProvider } from "@/components/ui/banner";
import { LocationSelectWithCreate } from "@/components/inventar/location-select-with-create";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DurationHoursInput } from "@/components/ui/duration-hours-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import {
  SearchableMultiSelect,
  SearchableSelect,
} from "@/components/ui/searchable-select";
import { TimeInput } from "@/components/ui/time-input";
import { useSettleOnChange } from "@/hooks/use-settle-on-change";
import { useLiveView, type LiveViewResult } from "@/hooks/use-live-view";
import { useSignOut } from "@/hooks/use-sign-out";
import { SimulatePaymentButton } from "@/app/upgrade/simulate-payment-button";
import { SignOutAndRedirectButton } from "@/app/invite-error/sign-out-redirect-button";
import { initializeServiceBoundaries } from "./service-boundaries";
import { WorkLifecycleCard } from "@/components/auftraege/work-lifecycle-card";
import {
  initializeLifecycleBoundary,
  ROUTE_REFRESH_EVENT,
} from "./lifecycle-boundaries";

import { PersonnelLifecycleSection } from "@/components/mitarbeiter/personnel-lifecycle-section";
import { PersonnelOwnActionsSection } from "@/components/mitarbeiter/personnel-own-actions-section";
import { initializePersonnelBoundary } from "./personnel-boundaries";

initializeServiceBoundaries();
initializeLifecycleBoundary();
const personnelInitialData = initializePersonnelBoundary();

function LifecycleRouteFixture(): React.JSX.Element {
  const [routeSnapshot, setRouteSnapshot] = useState(
    window.uiContractLifecycle.snapshot,
  );
  useEffect(() => {
    const reconcile = (): void =>
      setRouteSnapshot(structuredClone(window.uiContractLifecycle.snapshot));
    window.addEventListener(ROUTE_REFRESH_EVENT, reconcile);
    return () => window.removeEventListener(ROUTE_REFRESH_EVENT, reconcile);
  }, []);
  return (
    <section aria-label="Arbeitsstand und Auftragsdetails">
      <output aria-label="Auftragsstatus">
        {routeSnapshot.executionState === "in_progress"
          ? "In Bearbeitung"
          : "Nicht bearbeitet"}
      </output>
      <WorkLifecycleCard
        initialSnapshot={routeSnapshot}
        targetLabel="Prüfauftrag"
        isManager
      />
    </section>
  );
}

function NestedLocationFixture(): React.JSX.Element {
  const [location, setLocation] = useState("");
  const [submissions, setSubmissions] = useState(0);
  return (
    <section aria-label="Verschachtelte Lagererstellung">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmissions((count) => count + 1);
        }}
      >
        <Field label="Artikelbezeichnung">
          <Input defaultValue="Ventil" />
        </Field>
        <Field label="Lager">
          <LocationSelectWithCreate
            locations={[]}
            value={location}
            onValueChange={setLocation}
          />
        </Field>
        <Button type="submit">Artikel speichern</Button>
      </form>
      <output aria-label="Artikel gespeichert">{submissions}</output>
      <output aria-label="Übernommenes Lager">{location}</output>
    </section>
  );
}

function DropdownFixture(): React.JSX.Element {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState("Bereit");
  return (
    <section aria-label="Dropdown-Menü">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Projektaktionen testen</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setRevision((current) => current + 1);
            }}
          >
            Ansicht aktualisieren
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setResult("Übernommen")}>
            Markierung übernehmen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <output aria-label="Ansichtsrevision">{revision}</output>
      <output aria-label="Menüergebnis">{result}</output>
    </section>
  );
}

function SignOutFixture(): React.JSX.Element {
  const { signOut, isSigningOut } = useSignOut();
  return (
    <Button disabled={isSigningOut} onClick={() => void signOut()}>
      Sitzung beenden
    </Button>
  );
}

const OPTIONS = [
  { value: "anna", label: "Anna Müller" },
  { value: "bernd", label: "Bernd Schmidt" },
  { value: "cem", label: "Cem Yılmaz" },
];

function SettlementFixture({
  onRemove,
  onCancelled,
}: {
  onRemove: () => void;
  onCancelled: () => void;
}): React.JSX.Element {
  const [version, setVersion] = useState({ revision: 0 });
  const [status, setStatus] = useState("Bereit");
  const settle = useSettleOnChange(version, 1_000);
  return (
    <>
      <Button
        onClick={() => {
          setStatus("Wartet");
          void settle().then(() => setStatus("Beendet"));
        }}
      >
        Auf Aktualisierung warten
      </Button>
      <Button onClick={() => setVersion({ revision: version.revision + 1 })}>
        Serverdaten übernehmen
      </Button>
      <Button
        onClick={() => {
          setStatus("Wartet");
          void settle().then(() => setStatus("Beendet"));
          setVersion({ revision: version.revision + 1 });
        }}
      >
        Aktualisierung mit Serverantwort
      </Button>
      <output aria-label="Aktualisierungsstatus">{status}</output>
      <Button
        onClick={() => {
          void settle().then(onCancelled);
          onRemove();
        }}
      >
        Mit offener Aktualisierung entfernen
      </Button>
    </>
  );
}

function LiveViewEnableFixture(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [aborted, setAborted] = useState(0);
  const [requests, setRequests] = useState<Array<{ signal: AbortSignal; complete: () => void; fail: () => void }>>([]);
  const view = useLiveView<number>({
    tables: [],
    enabled,
    read: ({ signal }) => new Promise<LiveViewResult<number>>((resolve) => {
      signal.addEventListener('abort', () => setAborted((count) => count + 1), { once: true });
      setRequests((previous) => [...previous, {
        signal,
        complete: () => resolve({ ok: true, data: previous.length + 1 }),
        fail: () => resolve({ ok: false, error: 'Lesen fehlgeschlagen' }),
      }]);
    }),
  });
  return <section aria-label="Leseaktivierung">
    <button type="button" onClick={() => setEnabled((previous) => !previous)}>{enabled ? 'Lesen deaktivieren' : 'Lesen aktivieren'}</button>
    <button type="button" onClick={() => void view.refresh()}>Erneut lesen</button>
    <output aria-label="Lesevorgänge">{requests.length}</output>
    <output aria-label="Lesezustand">{view.isRefreshing ? 'Lädt' : 'Ruhend'}</output>
    <output aria-label="Abgebrochene Lesevorgänge">{aborted}</output>
    <output aria-label="Leseergebnis">{view.data ?? 'Unbekannt'}</output>
    <output aria-label="Lesestatus">{view.isStale ? 'Veraltet' : 'Aktuell'}</output>
    {requests.map((request, index) => <div key={index}>
      <output aria-label={`Lesesignal ${index + 1}`}>{request.signal.aborted ? 'Abgebrochen' : 'Aktiv'}</output>
      <button type="button" onClick={request.complete}>Lesen {index + 1} abschließen</button>
      <button type="button" onClick={request.fail}>Lesen {index + 1} fehlschlagen</button>
    </div>)}
  </section>;
}

function ContractFixture(): React.JSX.Element {
  const [single, setSingle] = useState("");
  const [multiple, setMultiple] = useState<string[]>([]);
  const [date, setDate] = useState<Date>();
  const [time, setTime] = useState("08:00");
  const [duration, setDuration] = useState("1");
  const [created, setCreated] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [action, setAction] = useState("Bereit");
  const [settlementMounted, setSettlementMounted] = useState(true);
  const [cancelled, setCancelled] = useState(false);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <DropdownFixture />
        <NestedLocationFixture />
        <section aria-label="Zahlung">
          <SimulatePaymentButton />
        </section>
        <section aria-label="Abmeldung">
          <SignOutFixture />
        </section>
        <section aria-label="Einladungswechsel">
          <SignOutAndRedirectButton
            inviteCode="fixture-invite"
            invitedEmail="fixture@example.invalid"
            isExistingUser
          />
        </section>
        <section aria-label="Einzelauswahl">
          <Field label="Verantwortliche Person" htmlFor="single" required>
            <SearchableSelect
              options={OPTIONS}
              value={single}
              onChange={setSingle}
              allowNone
              searchPlaceholder="Person suchen"
              action={{
                label: "Person anlegen",
                onClick: () => setCreated(true),
              }}
            />
          </Field>
          <output aria-label="Gewählte Person">{single || "Keine"}</output>
          <output aria-label="Person angelegt">
            {created ? "Ja" : "Nein"}
          </output>
          <Button>Nach der Einzelauswahl</Button>
        </section>
        <section aria-label="Mehrfachauswahl">
          <Field label="Team" htmlFor="multiple">
            <SearchableMultiSelect
              options={OPTIONS}
              selectedIds={multiple}
              onSelectionChange={setMultiple}
              allowNone
              searchPlaceholder="Team durchsuchen"
            />
          </Field>
          <output aria-label="Gewähltes Team">
            {multiple.join(",") || "Keine"}
          </output>
          <Button>Nach der Mehrfachauswahl</Button>
        </section>
        <section aria-label="Feldeingabe">
          <Field
            label="Einsatzdatum"
            htmlFor="date"
            description="Datum des Einsatzes"
            error="Datum prüfen"
            required
          >
            <DatePicker value={date} onChange={setDate} />
          </Field>
          <Field
            label="Einsatzbeginn"
            htmlFor="time"
            description="Berliner Ortszeit"
            error="Uhrzeit prüfen"
            required
          >
            <TimeInput value={time} onChange={setTime} />
          </Field>
          <Field
            label="Geplante Dauer"
            htmlFor="duration"
            description="In Stunden"
            error="Dauer prüfen"
            required
          >
            <DurationHoursInput value={duration} onChange={setDuration} />
          </Field>
        </section>
        <section aria-label="Zeilenaktionen">
          <Button>Vor den Aktionen</Button>
          <RowActionsMenu
            actions={[
              {
                label: "Markieren",
                icon: null,
                onSelect: () => setAction("Markiert"),
              },
              {
                label: "Bearbeiten",
                icon: null,
                onSelect: () => setDialog(true),
              },
            ]}
          />
          <Button>Nach den Aktionen</Button>
          <output aria-label="Aktionsergebnis">{action}</output>
          <Dialog open={dialog} onOpenChange={setDialog}>
            <DialogContent>
              <DialogTitle>Eintrag bearbeiten</DialogTitle>
              <DialogDescription>Bezeichnung ändern</DialogDescription>
              <Field label="Bezeichnung">
                <Input />
              </Field>
            </DialogContent>
          </Dialog>
        </section>
        <section aria-label="Aktualisierung">
          {settlementMounted && (
            <SettlementFixture
              onRemove={() => setSettlementMounted(false)}
              onCancelled={() => setCancelled(true)}
            />
          )}
          <output aria-label="Warten abgebrochen">
            {cancelled ? "Ja" : "Nein"}
          </output>
          <Button onClick={() => setSettlementMounted(false)}>
            Ansicht entfernen
          </Button>
          <output aria-label="Ansicht vorhanden">
            {settlementMounted ? "Ja" : "Nein"}
          </output>
        </section>
      </main>
    </BannerProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("UI contract fixture root is missing.");
createRoot(root).render(
  window.uiContractFixture === "customer" ? <CustomerContractFixture /> :
  window.uiContractFixture === "route-refresh" ? <RouteRefreshFixture /> :
  window.uiContractFixture === "live-view" ? <main><h1>Komponentenverträge</h1><LiveViewEnableFixture /></main> :
  window.uiContractFixture === "clock" ? <ClockContractFixture /> :
  window.uiContractFixture === "sidebar" ? <SidebarContractFixture /> :
  window.uiContractFixture === "organization" ? <OrganizationContractFixture /> : window.uiContractFixture === "calendar-board" ? <CalendarBoardContractFixture /> : window.uiContractFixture === "calendar-day" ? <CalendarDayContractFixture /> : window.uiContractFixture === "calendar-month" ? <CalendarMonthContractFixture /> : window.uiContractFixture === "list-navigation" ? <ListNavigationFixture /> : window.uiContractFixture === "options" ? <OptionContractFixture /> : window.uiContractFixture === "calendar" ? <CalendarContractFixture /> : window.uiContractFixture === "lifecycle" ? (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <LifecycleRouteFixture />
      </main>
    </BannerProvider>
  ) : window.uiContractFixture === "own-personnel" ? (
    <BannerProvider><main><h1>Komponentenverträge</h1><PersonnelOwnActionsSection /></main></BannerProvider>
  ) : window.uiContractFixture === "personnel" ? (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <PersonnelLifecycleSection
          data={personnelInitialData}
          canManage
          canAdministerAccess
        />
      </main>
    </BannerProvider>
  ) : (
    <ContractFixture />
  ),
);
