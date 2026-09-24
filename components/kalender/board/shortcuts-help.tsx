'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['t', 'Heute'],
  ['j / k', 'Nächster / vorheriger Zeitraum'],
  ['d / w / m', 'Tag / Plantafel / Monat'],
  ['z', 'Letzte Ablage rückgängig machen, solange der Hinweis sichtbar ist'],
  ['+ / -', 'Tagesansicht vergrößern / verkleinern'],
  ['Tab / Enter', 'Karte auswählen / Terminübersicht öffnen'],
  ['Pfeiltasten', 'Zwischen Zellen der Plantafel bewegen'],
  ['Alt + Ziehen', 'Termin kopieren statt verschieben'],
  ['Shift + Ziehen', 'Feines Raster im Tag; Ablage trotz Hinweis auf der Plantafel'],
  ['Esc', 'Ziehen abbrechen'],
  ['?', 'Diese Übersicht'],
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
