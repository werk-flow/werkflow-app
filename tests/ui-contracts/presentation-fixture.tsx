import { useRef, useState } from 'react';
import { usePageBodyKeyboardScroll } from '@/components/shared/page-body-keyboard-scroll';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BannerProvider, useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimeBlock } from '@/components/kalender/day-view/time-block';
import { calculateCalendarWorkBlocks } from '@/lib/time-tracking/calendar-blocks';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody } from '@/components/shared/page-shell';
import { LocationsView, type PendingLocationDraft } from '@/components/inventar/inventory-locations-view';
import type { InventoryLocation } from '@/lib/inventory/types';

const shortEntries: TimeEntry[] = ['clock_in', 'clock_out'].map((kind, index) => {
  const timestamp = `2026-09-08T08:0${index * 2}:00.000Z`;
  return {
    id: `short-${index}`,
    userId: 'worker',
    organizationId: 'org',
    entryType: kind === 'clock_in' ? 'clock_in' : 'clock_out',
    timestamp,
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    activityKind: 'travel',
  };
});
const shortBlock = calculateCalendarWorkBlocks(shortEntries)[0];
const savedLocation: InventoryLocation = {
  id: 'saved-location',
  parentLocationId: null,
  name: 'Servicefahrzeug',
  description: null,
  locationType: 'vehicle',
  sortOrder: 0,
  isActive: true,
};

/** A confirmation longer than a phone screen, built without AlertDialogBody or an extra class. */
function LongConfirmation(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Lange Bestätigung öffnen</Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Organisation „Probe“ löschen?</AlertDialogTitle>
          {Array.from({ length: 20 }, (_, index) => (
            <AlertDialogDescription key={index}>
              Absatz {index + 1}: Aufträge, Projekte, Kunden, Dokumente und Einsätze dieser Organisation
              werden endgültig gelöscht. Erfasste Zeiten bleiben für die Lohnabrechnung erhalten.
            </AlertDialogDescription>
          ))}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Endgültig löschen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PresentationControls(): React.JSX.Element {
  const { showBanner, dismissBanner } = useBanner();
  const [open, setOpen] = useState(false);
  const [openedBlock, setOpenedBlock] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<PendingLocationDraft | null>(null);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [soleControlDisabled, setSoleControlDisabled] = useState(false);
  // The app shell owns the page-body keyboard scroll; the fixture mounts the same hook around its PageBody.
  const mainRef = useRef<HTMLDivElement>(null);
  usePageBodyKeyboardScroll(mainRef);
  return (
    <main className="space-y-4 p-6" style={{ paddingTop: 96 }}>
      <section aria-label="Seitenkopf">
        <PageHeader
          title="Mitarbeiter"
          actions={
            <>
              <Button variant="outline">Personalakte</Button>
              <Button>Hinzufügen</Button>
            </>
          }
        />
      </section>
      <section aria-label="Lagerabgleich">
        <Button
          onClick={() =>
            setPendingLocation({ confirmedId: null, name: savedLocation.name, locationType: 'vehicle' })
          }
        >
          Anlegen beginnen
        </Button>
        <Button
          onClick={() =>
            setPendingLocation((current) => (current ? { ...current, confirmedId: savedLocation.id } : null))
          }
        >
          Antwort erhalten
        </Button>
        <Button onClick={() => setLocations([savedLocation])}>Serverliste erhalten</Button>
        <LocationsView locations={locations} items={[]} itemCounts={{}} pendingDraft={pendingLocation} />
      </section>
      <Button
        onClick={() => showBanner({ variant: 'success', message: 'Erster Hinweis', autoDismissMs: null })}
      >
        Erster Hinweis
      </Button>
      <Button
        onClick={() =>
          showBanner({
            variant: 'info',
            message: 'Zweiter Hinweis',
            autoDismissMs: null,
            actionLabel: 'Weiter',
            onAction: () =>
              showBanner({ variant: 'success', message: 'Aktion abgeschlossen', autoDismissMs: null }),
          })
        }
      >
        Zweiter Hinweis
      </Button>
      <Button onClick={dismissBanner}>Ausblenden</Button>
      <Field label="Bezeichnung">
        <Input />
      </Field>
      <Button onClick={() => setOpen(true)}>Formular öffnen</Button>
      <LongConfirmation />
      <section aria-label="Seitenkörper">
        <Button onClick={() => setSoleControlDisabled((current) => !current)}>Knopf umschalten</Button>
        <div ref={mainRef} style={{ height: 160, display: 'flex', flexDirection: 'column' }}>
          <PageBody>
            <div hidden>
              <Button>Versteckter Knopf</Button>
            </div>
            <Button disabled={soleControlDisabled}>Einziger Knopf</Button>
            <div style={{ height: 600 }} />
          </PageBody>
        </div>
      </section>
      <section aria-label="Kurze Fahrt" className="relative" style={{ height: 64 }}>
        {shortBlock && (
          <TimeBlock
            block={shortBlock}
            segments={[{ id: 'short', type: 'work', startMinutes: 0, endMinutes: 2 }]}
            startMinutes={0}
            endMinutes={2}
            hourWidth={60}
            laneTop="3px"
            laneHeight="50px"
            changeRequestMap={{}}
            showName={null}
            canManage
            onOpen={() => setOpenedBlock(true)}
            onPointerDownMove={() => {}}
            onPointerDownEdge={() => {}}
          />
        )}
      </section>
      <output aria-label="Zeitblock geöffnet">{openedBlock ? 'Ja' : 'Nein'}</output>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent workspace>
          <DialogTitle>Arbeitsbereich</DialogTitle>
          <DialogDescription>Kurze und lange Formulare im selben Dialog.</DialogDescription>
          <Tabs defaultValue="short" className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="short">Kurz</TabsTrigger>
              <TabsTrigger value="long">Lang</TabsTrigger>
            </TabsList>
            <TabsContent value="short" className="min-h-0">
              <DialogBody>
                <Field label="Titel">
                  <Input />
                </Field>
              </DialogBody>
            </TabsContent>
            <TabsContent value="long" className="min-h-0 overflow-y-auto">
              <DialogBody>
                {Array.from({ length: 20 }, (_, index) => (
                  <Field key={index} label={`Zeile ${index + 1}`}>
                    <Input />
                  </Field>
                ))}
              </DialogBody>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={() => setOpen(false)}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export function PresentationFixture(): React.JSX.Element {
  return (
    <BannerProvider>
      <PresentationControls />
    </BannerProvider>
  );
}
