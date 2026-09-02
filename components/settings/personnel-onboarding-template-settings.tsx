"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useBanner } from "@/components/ui/banner";
import { useRealtimeRouterRefresh } from "@/hooks/use-realtime-router-refresh";
import { useServerAction } from "@/hooks/use-server-action";
import {
  publishPersonnelOnboardingTemplate,
  type PersonnelOnboardingTemplateSummary,
} from "@/lib/personnel/lifecycle-actions";
import type { PersonnelRequirementType } from "@/lib/personnel/lifecycle";

const REQUIREMENT_OPTIONS: Array<{ value: PersonnelRequirementType; label: string }> = [
  { value: "document", label: "Dokument" },
  { value: "qualification", label: "Qualifikation" },
  { value: "employment_condition", label: "Beschäftigungsbedingung" },
  { value: "work_schedule", label: "Arbeitszeitmodell" },
  { value: "team", label: "Team" },
  { value: "access", label: "Zugang" },
  { value: "acknowledgement", label: "Bestätigung" },
  { value: "manual", label: "Manueller Punkt" },
];

export function PersonnelOnboardingTemplateSettings({ templates }: { templates: PersonnelOnboardingTemplateSummary[] | null }) {
  const { showBanner } = useBanner();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [requirementType, setRequirementType] = useState<PersonnelRequirementType>("manual");
  const [required, setRequired] = useState(true);
  const [blocksAccess, setBlocksAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(publishPersonnelOnboardingTemplate);

  useRealtimeRouterRefresh({ tables: ["personnel_onboarding_templates"] });

  async function submit(): Promise<void> {
    setError(null);
    const result = await run({
      templateId: null,
      expectedVersion: 0,
      name,
      description: null,
      items: [{
        requirementType,
        title: itemTitle,
        description: null,
        isRequired: required,
        blocksAccess,
        dueOffsetDays: null,
      }],
      operationId: crypto.randomUUID(),
    });
    if (!result.success) {
      setError(result.error === "invalid_input" ? "Bitte gib einen Namen und einen ersten Punkt an." : "Die Vorlage konnte nicht veröffentlicht werden.");
      return;
    }
    setOpen(false);
    setName("");
    setItemTitle("");
    showBanner({ variant: "success", message: "Onboardingvorlage wurde veröffentlicht." });
  }

  return (
    <section className="space-y-4 border-b px-4 py-5 sm:px-6" aria-labelledby="onboarding-template-settings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="onboarding-template-settings-title" className="text-base font-semibold">Onboardingvorlagen</h2>
          <p className="mt-1 text-sm text-muted-foreground">Wiederverwendbare Ausgangspunkte. Es gibt keine automatisch angelegte Standardvorlage.</p>
        </div>
        <Button size="sm" onClick={() => { setError(null); setOpen(true); }} disabled={templates === null}><Plus className="size-4" /> Vorlage</Button>
      </div>
      {templates === null ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <p>Die Onboardingvorlagen konnten nicht geladen werden.</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => window.location.reload()}>Erneut laden</Button>
        </div>
      ) : templates.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Noch keine Vorlage eingerichtet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {templates.map((template) => (
            <li key={template.id} className="flex items-center justify-between gap-3 p-3">
              <div><p className="text-sm font-medium">{template.name}</p><p className="text-xs text-muted-foreground">Version {template.currentVersionNumber}{template.description ? ` · ${template.description}` : ""}</p></div>
              <Badge variant="secondary">{template.state === "published" ? "Veröffentlicht" : template.state === "draft" ? "Entwurf" : "Archiviert"}</Badge>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(value) => { if (!isPending) setOpen(value); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Onboardingvorlage veröffentlichen</DialogTitle><DialogDescription>Die erste Version enthält einen klaren Punkt. Weitere Anforderungen werden im erzeugten Plan bearbeitet.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <div className="space-y-2"><Label htmlFor="template-name">Name</Label><Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="template-requirement-type">Art des ersten Punkts</Label><SearchableSelect id="template-requirement-type" options={REQUIREMENT_OPTIONS} value={requirementType} onChange={(value) => setRequirementType(value as PersonnelRequirementType)} searchPlaceholder="Art suchen…" /></div>
            <div className="space-y-2"><Label htmlFor="template-item-title">Erster Punkt</Label><Input id="template-item-title" value={itemTitle} onChange={(event) => setItemTitle(event.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={required} onCheckedChange={(value) => setRequired(value === true)} />Erforderlich</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={blocksAccess} onCheckedChange={(value) => setBlocksAccess(value === true)} />Blockiert die Zugangsaktivierung</label>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Abbrechen</Button><Button onClick={() => void submit()} disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Veröffentlichen</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
