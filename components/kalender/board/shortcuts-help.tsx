'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Every line holds in every view unless it names one; the container owns the
 * key handler and the board its grid navigation, so this list is the contract
 * the audit checks against.
 */
const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['t', 'Heute'],
  ['j / k', 'Nächster / vorheriger Zeitraum'],
  ['d / w / m', 'Tag / Plantafel / Monat'],
  ['c', 'Neuen Kalendereintrag anlegen'],
  ['z', 'Letzte Ablage rückgängig machen, solange der Hinweis sichtbar ist'],
  ['Tab, Enter', 'Zur nächsten Karte, Terminübersicht öffnen'],
  ['Esc', 'Ziehen abbrechen; Übersicht, Dialog oder Parkplatz schließen'],
  ['?', 'Diese Übersicht'],
  ['+ / -', 'Nur Tag: vergrößern / verkleinern'],
  ['Pfeiltasten', 'Nur Plantafel: zwischen Zellen bewegen (Tab erreicht die erste Zelle)'],
  ['Alt + Ziehen', 'Nur Plantafel: Termin kopieren statt verschieben'],
  ['Shift + Ziehen', 'Ablage trotz Hinweis; im Tag feines 5-Minuten-Raster'],
];

/** The `?` overlay (P1-24a, criterion 18). */
export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tastenkürzel</DialogTitle>
          <DialogDescription>Die Kürzel gelten im Kalender außerhalb von Eingabefeldern und Dialogen.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, description]) => (
            <div key={keys} className="contents">
              <dt><kbd className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd></dt>
              <dd className="text-muted-foreground">{description}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
