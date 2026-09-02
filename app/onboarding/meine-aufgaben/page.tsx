import type { Metadata } from "next";

import { PersonnelOwnActionsSection } from "@/components/mitarbeiter/personnel-own-actions-section";

export const metadata: Metadata = {
  title: "Meine Onboardingaufgaben - WerkFlow",
};

export default function PersonnelPrestartPage() {
  return (
    <main className="w-full max-w-2xl space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Dein Start bei WerkFlow</h1>
        <p className="text-sm text-muted-foreground">
          Dein vollständiger Organisationszugang beginnt zum geplanten Zeitpunkt. Bis dahin kannst du nur deine freigegebenen Unterlagen und Aufgaben bearbeiten.
        </p>
      </div>
      <PersonnelOwnActionsSection forceVisible />
    </main>
  );
}
