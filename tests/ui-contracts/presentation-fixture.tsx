import { useState } from 'react';
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

function PresentationControls(): React.JSX.Element {
  const { showBanner, dismissBanner } = useBanner();
  const [open, setOpen] = useState(false);
  const [openedBlock, setOpenedBlock] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<PendingLocationDraft | null>(null);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
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
