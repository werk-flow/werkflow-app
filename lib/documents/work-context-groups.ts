import type { DocumentEmployee, OrganizationDocument } from '@/lib/documents/types';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';

export type JobDocumentGroup = {
  job: Job;
  documents: OrganizationDocument[];
};

export type ProjectDocumentGroup = {
  project: ProjectWithDetails;
  directDocuments: OrganizationDocument[];
  childJobGroups: JobDocumentGroup[];
  totalDocumentCount: number;
};

export type SimpleDocumentGroup = {
  id: string;
  title: string;
  typeLabel: 'Kunde' | 'Mitarbeiter';
  href: string | null;
  documents: OrganizationDocument[];
};

type WorkContextGroups = {
  projectGroups: ProjectDocumentGroup[];
  standaloneJobGroups: JobDocumentGroup[];
  clientGroups: SimpleDocumentGroup[];
  employeeGroups: SimpleDocumentGroup[];
};

export function getLatestUpdatedAt(documents: OrganizationDocument[]): string | null {
  if (documents.length === 0) return null;

  return (
    documents
      .map((document) => document.updatedAt)
      .sort((firstDate, secondDate) => secondDate.localeCompare(firstDate))[0] ?? null
  );
}

function addDocument(
  map: Map<string, OrganizationDocument[]>,
  targetId: string,
  document: OrganizationDocument,
): void {
  const documents = map.get(targetId) ?? [];
  if (!documents.some((existingDocument) => existingDocument.id === document.id)) {
    documents.push(document);
  }
  map.set(targetId, documents);
}

export function buildWorkContextGroups({
  documents,
  jobs,
  projects,
  clients,
  employees,
}: {
  documents: OrganizationDocument[];
  jobs: Job[];
  projects: ProjectWithDetails[];
  clients: Client[];
  employees: DocumentEmployee[];
}): WorkContextGroups {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const employeesById = new Map(employees.map((employee) => [employee.userId, employee]));
  const documentsByJobId = new Map<string, OrganizationDocument[]>();
  const documentsByProjectId = new Map<string, OrganizationDocument[]>();
  const documentsByClientId = new Map<string, OrganizationDocument[]>();
  const documentsByEmployeeId = new Map<string, OrganizationDocument[]>();

  for (const document of documents) {
    for (const link of document.links) {
      if (link.jobId && jobsById.has(link.jobId)) {
        addDocument(documentsByJobId, link.jobId, document);
      }
      if (link.projectId && projectsById.has(link.projectId)) {
        addDocument(documentsByProjectId, link.projectId, document);
      }
      if (link.clientId && clientsById.has(link.clientId)) {
        addDocument(documentsByClientId, link.clientId, document);
      }
      if (link.employeeId && employeesById.has(link.employeeId)) {
        addDocument(documentsByEmployeeId, link.employeeId, document);
      }
    }
  }

  const jobsByProjectId = new Map<string, Job[]>();
  for (const job of jobs) {
    if (!job.projectId || !projectsById.has(job.projectId)) continue;

    const projectJobs = jobsByProjectId.get(job.projectId) ?? [];
    projectJobs.push(job);
    jobsByProjectId.set(job.projectId, projectJobs);
  }

  const projectGroups = projects
    .map((project): ProjectDocumentGroup => {
      const directDocuments = documentsByProjectId.get(project.id) ?? [];
      const childJobGroups = (jobsByProjectId.get(project.id) ?? [])
        .map((job) => ({
          job,
          documents: documentsByJobId.get(job.id) ?? [],
        }))
        .filter((group) => group.documents.length > 0);

      return {
        project,
        directDocuments,
        childJobGroups,
        totalDocumentCount:
          directDocuments.length + childJobGroups.reduce((total, group) => total + group.documents.length, 0),
      };
    })
    .filter((group) => group.totalDocumentCount > 0);

  const standaloneJobGroups = jobs
    .filter((job) => !job.projectId || !projectsById.has(job.projectId))
    .map((job) => ({
      job,
      documents: documentsByJobId.get(job.id) ?? [],
    }))
    .filter((group) => group.documents.length > 0);

  const clientGroups = clients
    .map(
      (client): SimpleDocumentGroup => ({
        id: client.id,
        title: client.name,
        typeLabel: 'Kunde',
        href: `/kunden/${encodeURIComponent(client.id)}`,
        documents: documentsByClientId.get(client.id) ?? [],
      }),
    )
    .filter((group) => group.documents.length > 0);

  const employeeGroups = employees
    .map((employee): SimpleDocumentGroup => {
      const title = employee.name || employee.email || 'Mitarbeiter';

      return {
        id: employee.userId,
        title,
        typeLabel: 'Mitarbeiter',
        href: `/mitarbeiter/${encodeURIComponent(employee.userId)}`,
        documents: documentsByEmployeeId.get(employee.userId) ?? [],
      };
    })
    .filter((group) => group.documents.length > 0);

  return { projectGroups, standaloneJobGroups, clientGroups, employeeGroups };
}

export function getProjectHref(project: ProjectWithDetails): string | null {
  if (!project.projectNumber) return null;
  return `/auftraege/projekt/${encodeURIComponent(project.projectNumber)}`;
}

export function getJobHref({
  job,
  project,
}: {
  job: Job;
  project?: ProjectWithDetails | null;
}): string | null {
  if (!job.jobNumber) return null;

  if (project?.projectNumber) {
    return `/auftraege/projekt/${encodeURIComponent(project.projectNumber)}/${encodeURIComponent(job.jobNumber)}`;
  }

  return `/auftraege/${encodeURIComponent(job.jobNumber)}`;
}
