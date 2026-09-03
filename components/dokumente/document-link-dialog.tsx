"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  Check,
  FolderKanban,
  LinkIcon,
  Search,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDocumentLinkCatalog,
  updateDocumentLinks,
} from "@/lib/documents/actions";
import type {
  DocumentEmployee,
  DocumentEquipment,
  OrganizationDocument,
} from "@/lib/documents/types";
import type { Client, Job, ProjectWithDetails } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { useServerAction } from "@/hooks/use-server-action";

type LinkTargetType = "job" | "project" | "client" | "employee" | "equipment";
type LinkTarget =
  Job | ProjectWithDetails | Client | DocumentEmployee | DocumentEquipment;

type DocumentLinkDialogProps = {
  document: OrganizationDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs?: Job[];
  projects?: ProjectWithDetails[];
  clients?: Client[];
  employees?: DocumentEmployee[];
  equipment?: DocumentEquipment[];
  onComplete: (variant: "success" | "error", message: string) => void;
};

function getJobLabel(job: Job): string {
  return job.jobNumber ? `${job.jobNumber} · ${job.title}` : job.title;
}

function getProjectLabel(project: ProjectWithDetails): string {
  return project.projectNumber
    ? `${project.projectNumber} · ${project.name}`
    : project.name;
}

function getClientLabel(client: Client): string {
  return client.name;
}

function getEmployeeLabel(employee: DocumentEmployee): string {
  const name = [employee.firstName, employee.lastName]
    .filter(Boolean)
    .join(" ");
  return name || employee.email || "Mitarbeiter";
}

function getEquipmentLabel(equipment: DocumentEquipment): string {
  return `${equipment.equipmentNumber} · ${equipment.name}`;
}

function getTargetId(target: LinkTarget, targetType: LinkTargetType): string {
  return targetType === "employee"
    ? (target as DocumentEmployee).userId
    : (target as Job | ProjectWithDetails | Client | DocumentEquipment).id;
}

function getLinkedJobIds(document: OrganizationDocument | null): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.jobId)
      .filter((jobId): jobId is string => Boolean(jobId)) ?? [],
  );
}

function getLinkedProjectIds(
  document: OrganizationDocument | null,
): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.projectId)
      .filter((projectId): projectId is string => Boolean(projectId)) ?? [],
  );
}

function getLinkedClientIds(
  document: OrganizationDocument | null,
): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.clientId)
      .filter((clientId): clientId is string => Boolean(clientId)) ?? [],
  );
}

function getLinkedEmployeeIds(
  document: OrganizationDocument | null,
): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.employeeId)
      .filter((employeeId): employeeId is string => Boolean(employeeId)) ?? [],
  );
}

function getLinkedEquipmentIds(
  document: OrganizationDocument | null,
): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.equipmentId)
      .filter((equipmentId): equipmentId is string => Boolean(equipmentId)) ??
      [],
  );
}

function formatLinkCount(count: number): string {
  return count === 1 ? "1 Verknüpfung" : `${count} Verknüpfungen`;
}

function formatChangeCount(count: number): string {
  return count === 1 ? "1 Änderung" : `${count} Änderungen`;
}

function getUpdateMessage(result: {
  success: boolean;
  addedCount?: number;
  removedCount?: number;
  failedCount?: number;
  error?: string;
}): { variant: "success" | "error"; message: string } {
  const addedCount = result.addedCount ?? 0;
  const removedCount = result.removedCount ?? 0;
  const failedCount = result.failedCount ?? 0;

  if (result.success) {
    if (addedCount === 0 && removedCount === 0) {
      return { variant: "success", message: "Keine Änderungen vorgenommen." };
    }
    if (addedCount > 0 && removedCount > 0) {
      return {
        variant: "success",
        message: `${formatLinkCount(addedCount)} hinzugefügt, ${formatLinkCount(removedCount)} entfernt.`,
      };
    }
    if (addedCount > 0) {
      return {
        variant: "success",
        message:
          addedCount === 1
            ? "Verknüpfung wurde hinzugefügt."
            : `${addedCount} Verknüpfungen wurden hinzugefügt.`,
      };
    }
    return {
      variant: "success",
      message:
        removedCount === 1
          ? "Verknüpfung wurde entfernt."
          : `${removedCount} Verknüpfungen wurden entfernt.`,
    };
  }

  if (failedCount > 0 && (addedCount > 0 || removedCount > 0)) {
    return {
      variant: "error",
      message: `${formatChangeCount(addedCount + removedCount)} gespeichert, ${formatChangeCount(failedCount)} fehlgeschlagen.`,
    };
  }

  return {
    variant: "error",
    message: "Die Verknüpfungen konnten nicht aktualisiert werden.",
  };
}

export function DocumentLinkDialog({
  document,
  open,
  onOpenChange,
  jobs: jobsProp,
  projects: projectsProp,
  clients: clientsProp,
  employees: employeesProp,
  equipment: equipmentProp,
  onComplete,
}: DocumentLinkDialogProps) {
  const { run: runSaveLinks, isPending: isSaving } =
    useServerAction(updateDocumentLinks);
  const { run: runCatalogFetch, isPending: isCatalogPending } = useServerAction(
    getDocumentLinkCatalog,
  );
  const [targetType, setTargetType] = useState<LinkTargetType>("job");
  const [searchQuery, setSearchQuery] = useState("");
  const [fetchedCatalog, setFetchedCatalog] = useState<{
    jobs: Job[];
    projects: ProjectWithDetails[];
    clients: Client[];
    employees: DocumentEmployee[];
    equipment: DocumentEquipment[];
  } | null>(null);
  const jobs = useMemo(
    () => jobsProp ?? fetchedCatalog?.jobs ?? [],
    [fetchedCatalog?.jobs, jobsProp],
  );
  const projects = useMemo(
    () => projectsProp ?? fetchedCatalog?.projects ?? [],
    [fetchedCatalog?.projects, projectsProp],
  );
  const clients = useMemo(
    () => clientsProp ?? fetchedCatalog?.clients ?? [],
    [clientsProp, fetchedCatalog?.clients],
  );
  const employees = useMemo(
    () => employeesProp ?? fetchedCatalog?.employees ?? [],
    [employeesProp, fetchedCatalog?.employees],
  );
  const equipment = useMemo(
    () => equipmentProp ?? fetchedCatalog?.equipment ?? [],
    [equipmentProp, fetchedCatalog?.equipment],
  );
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(() =>
    getLinkedJobIds(document),
  );
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    () => getLinkedProjectIds(document),
  );
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(() =>
    getLinkedClientIds(document),
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(
    () => getLinkedEmployeeIds(document),
  );
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<Set<string>>(
    () => getLinkedEquipmentIds(document),
  );

  const initialLinkedJobIds = useMemo(
    () => getLinkedJobIds(document),
    [document],
  );
  const initialLinkedProjectIds = useMemo(
    () => getLinkedProjectIds(document),
    [document],
  );
  const initialLinkedClientIds = useMemo(
    () => getLinkedClientIds(document),
    [document],
  );
  const initialLinkedEmployeeIds = useMemo(
    () => getLinkedEmployeeIds(document),
    [document],
  );
  const initialLinkedEquipmentIds = useMemo(
    () => getLinkedEquipmentIds(document),
    [document],
  );

  const needsCatalogFetch =
    open &&
    !!document &&
    (jobsProp === undefined ||
      projectsProp === undefined ||
      clientsProp === undefined ||
      employeesProp === undefined ||
      equipmentProp === undefined) &&
    fetchedCatalog === null;

  useEffect(() => {
    if (!needsCatalogFetch) return;

    let cancelled = false;

    void (async () => {
      const result = await runCatalogFetch();
      if (cancelled) return;

      if (result.success) {
        setFetchedCatalog({
          jobs: result.jobs,
          projects: result.projects,
          clients: result.clients,
          employees: result.employees,
          equipment: result.equipment,
        });
      } else {
        onComplete(
          "error",
          "Aufträge, Projekte, Kunden, Mitarbeiter und Anlagen konnten nicht geladen werden.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsCatalogFetch, onComplete, runCatalogFetch]);

  const isLoadingCatalog = needsCatalogFetch && isCatalogPending;

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("de-DE");

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) =>
        getJobLabel(job)
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearchQuery),
      ),
    [jobs, normalizedSearchQuery],
  );
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        getProjectLabel(project)
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearchQuery),
      ),
    [normalizedSearchQuery, projects],
  );
  const filteredClients = useMemo(
    () =>
      clients.filter((client) =>
        getClientLabel(client)
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearchQuery),
      ),
    [clients, normalizedSearchQuery],
  );
  const filteredEmployees = useMemo(
    () =>
      employees.filter((employee) =>
        getEmployeeLabel(employee)
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearchQuery),
      ),
    [employees, normalizedSearchQuery],
  );
  const filteredEquipment = useMemo(
    () =>
      equipment.filter((item) =>
        getEquipmentLabel(item)
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearchQuery),
      ),
    [equipment, normalizedSearchQuery],
  );

  const visibleTargets: LinkTarget[] =
    targetType === "job"
      ? filteredJobs
      : targetType === "project"
        ? filteredProjects
        : targetType === "client"
          ? filteredClients
          : targetType === "employee"
            ? filteredEmployees
            : filteredEquipment;

  const addJobIds = [...selectedJobIds].filter(
    (jobId) => !initialLinkedJobIds.has(jobId),
  );
  const addProjectIds = [...selectedProjectIds].filter(
    (projectId) => !initialLinkedProjectIds.has(projectId),
  );
  const addClientIds = [...selectedClientIds].filter(
    (clientId) => !initialLinkedClientIds.has(clientId),
  );
  const addEmployeeIds = [...selectedEmployeeIds].filter(
    (employeeId) => !initialLinkedEmployeeIds.has(employeeId),
  );
  const addEquipmentIds = [...selectedEquipmentIds].filter(
    (equipmentId) => !initialLinkedEquipmentIds.has(equipmentId),
  );
  const removeLinkIds =
    document?.links
      .filter((link) => {
        if (link.jobId) return !selectedJobIds.has(link.jobId);
        if (link.projectId) return !selectedProjectIds.has(link.projectId);
        if (link.clientId) return !selectedClientIds.has(link.clientId);
        if (link.employeeId) return !selectedEmployeeIds.has(link.employeeId);
        if (link.equipmentId)
          return !selectedEquipmentIds.has(link.equipmentId);
        return false;
      })
      .map((link) => link.id) ?? [];

  const changeCount =
    addJobIds.length +
    addProjectIds.length +
    addClientIds.length +
    addEmployeeIds.length +
    addEquipmentIds.length +
    removeLinkIds.length;
  const selectedCount =
    selectedJobIds.size +
    selectedProjectIds.size +
    selectedClientIds.size +
    selectedEmployeeIds.size +
    selectedEquipmentIds.size;

  function handleTargetTypeChange(nextTargetType: LinkTargetType) {
    setTargetType(nextTargetType);
    setSearchQuery("");
  }

  function toggleJob(jobId: string) {
    setSelectedJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function toggleProject(projectId: string) {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function toggleClient(clientId: string) {
    setSelectedClientIds((current) => {
      const next = new Set(current);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  function toggleEmployee(employeeId: string) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function toggleEquipment(equipmentId: string) {
    setSelectedEquipmentIds((current) => {
      const next = new Set(current);
      if (next.has(equipmentId)) next.delete(equipmentId);
      else next.add(equipmentId);
      return next;
    });
  }

  function handleSave() {
    if (!document || changeCount === 0) return;

    void (async () => {
      const result = await runSaveLinks({
        documentId: document.id,
        addJobIds,
        addProjectIds,
        addClientIds,
        addEmployeeIds,
        addEquipmentIds,
        removeLinkIds,
      });

      const feedback = getUpdateMessage(result);
      onComplete(feedback.variant, feedback.message);

      if (
        result.success ||
        (result.addedCount ?? 0) + (result.removedCount ?? 0) > 0
      ) {
        onOpenChange(false);
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Verknüpfungen verwalten</DialogTitle>
          <DialogDescription>
            Wähle Aufträge, Projekte, Kunden, Mitarbeiter und Anlagen für „
            {document?.displayName}“. Abgewählte bestehende Verknüpfungen werden
            entfernt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Button
              type="button"
              variant={targetType === "job" ? "secondary" : "outline"}
              onClick={() => handleTargetTypeChange("job")}
            >
              <BriefcaseBusiness className="size-4" />
              Aufträge
              {selectedJobIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedJobIds.size}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant={targetType === "project" ? "secondary" : "outline"}
              onClick={() => handleTargetTypeChange("project")}
            >
              <FolderKanban className="size-4" />
              Projekte
              {selectedProjectIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedProjectIds.size}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant={targetType === "client" ? "secondary" : "outline"}
              onClick={() => handleTargetTypeChange("client")}
            >
              <Users className="size-4" />
              Kunden
              {selectedClientIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedClientIds.size}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant={targetType === "employee" ? "secondary" : "outline"}
              onClick={() => handleTargetTypeChange("employee")}
            >
              <UserRound className="size-4" />
              Mitarbeiter
              {selectedEmployeeIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedEmployeeIds.size}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant={targetType === "equipment" ? "secondary" : "outline"}
              onClick={() => handleTargetTypeChange("equipment")}
            >
              <Wrench className="size-4" />
              Anlagen
              {selectedEquipmentIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedEquipmentIds.size}
                </span>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2 rounded-md border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={
                targetType === "job"
                  ? "Auftrag suchen..."
                  : targetType === "project"
                    ? "Projekt suchen..."
                    : targetType === "client"
                      ? "Kunde suchen..."
                      : targetType === "employee"
                        ? "Mitarbeiter suchen..."
                        : "Anlage suchen..."
              }
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="max-h-80 overflow-auto rounded-md border">
            {isLoadingCatalog ? (
              <div className="divide-y" role="status" aria-busy="true">
                <span className="sr-only">Einträge werden geladen.</span>
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="flex items-center gap-3 px-3 py-2.5">
                    <Skeleton className="size-4 shrink-0 rounded-sm" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48 max-w-full" />
                      <Skeleton className="h-3 w-32 max-w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visibleTargets.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Keine passenden Einträge gefunden.
              </div>
            ) : (
              <div className="divide-y">
                {visibleTargets.map((target) => {
                  const isJob = targetType === "job";
                  const isProject = targetType === "project";
                  const isClient = targetType === "client";
                  const isEmployee = targetType === "employee";
                  const targetId = getTargetId(target, targetType);
                  const isSelected = isJob
                    ? selectedJobIds.has(targetId)
                    : isProject
                      ? selectedProjectIds.has(targetId)
                      : isClient
                        ? selectedClientIds.has(targetId)
                        : isEmployee
                          ? selectedEmployeeIds.has(targetId)
                          : selectedEquipmentIds.has(targetId);
                  const wasLinked = isJob
                    ? initialLinkedJobIds.has(targetId)
                    : isProject
                      ? initialLinkedProjectIds.has(targetId)
                      : isClient
                        ? initialLinkedClientIds.has(targetId)
                        : isEmployee
                          ? initialLinkedEmployeeIds.has(targetId)
                          : initialLinkedEquipmentIds.has(targetId);
                  const label = isJob
                    ? getJobLabel(target as Job)
                    : isProject
                      ? getProjectLabel(target as ProjectWithDetails)
                      : isClient
                        ? getClientLabel(target as Client)
                        : isEmployee
                          ? getEmployeeLabel(target as DocumentEmployee)
                          : getEquipmentLabel(target as DocumentEquipment);

                  return (
                    <button
                      key={targetId}
                      type="button"
                      onClick={() => {
                        if (isJob) toggleJob(targetId);
                        else if (isProject) toggleProject(targetId);
                        else if (isClient) toggleClient(targetId);
                        else if (isEmployee) toggleEmployee(targetId);
                        else toggleEquipment(targetId);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                        isSelected && "bg-accent",
                      )}
                    >
                      {isJob ? (
                        <BriefcaseBusiness className="size-4 shrink-0 text-muted-foreground" />
                      ) : isProject ? (
                        <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                      ) : isClient ? (
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                      ) : isEmployee ? (
                        <UserRound className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Wrench className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {isSelected
                            ? wasLinked
                              ? "Verknüpft"
                              : "Neu ausgewählt"
                            : wasLinked
                              ? "Wird entfernt"
                              : targetType === "job"
                                ? "Auftrag"
                                : targetType === "project"
                                  ? "Projekt"
                                  : targetType === "client"
                                    ? "Kunde"
                                    : targetType === "employee"
                                      ? "Mitarbeiter"
                                      : "Anlage"}
                        </span>
                      </span>
                      {isSelected && (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <p className="mr-auto text-sm text-muted-foreground">
            {selectedCount} verknüpft
            {changeCount > 0 ? ` · ${formatChangeCount(changeCount)}` : ""}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoadingCatalog || changeCount === 0}
          >
            <LinkIcon className="size-4" />
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
