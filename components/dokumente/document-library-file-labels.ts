import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  type LucideIcon,
} from 'lucide-react';

import type {
  DocumentArchive,
  DocumentAuditEvent,
  DocumentFolder,
  DocumentOrigin,
  OrganizationDocument,
} from '@/lib/documents/types';
import { formatGermanDate } from '@/lib/utils';

/** How the document library names a file: icon, type, uploader, links and audit events. */

export function getUploaderName(document: OrganizationDocument): string {
  return getUserDisplayName(document.uploader);
}

export function getUserDisplayName(
  uploader: OrganizationDocument['uploader'] | DocumentFolder['creator'],
): string {
  if (!uploader) return 'Unbekannt';

  const fullName = [uploader.firstName, uploader.lastName].filter(Boolean).join(' ').trim();
  return fullName || uploader.email || 'Unbekannt';
}

/** The audit history names a member by email; a former member keeps no email and is named instead. */
export function getAuditActorLabel(actor: DocumentAuditEvent['actor']): string | null {
  if (!actor) return null;
  return actor.email ?? getUserDisplayName(actor);
}

export function getFileIcon(document: OrganizationDocument): LucideIcon {
  const mimeType = document.mimeType ?? '';
  const fileName = document.displayName.toLowerCase();

  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return FileText;
  if (mimeType.includes('spreadsheet') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
    return FileSpreadsheet;
  }
  if (mimeType.includes('zip') || fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
    return FileArchive;
  }
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return FileType;
  }
  return File;
}

export function getFileTypeLabel(document: OrganizationDocument): string {
  const mimeType = document.mimeType ?? '';
  const fileName = document.displayName.toLowerCase();

  if (mimeType.startsWith('image/')) return 'Bild';
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return 'PDF';
  if (mimeType.includes('spreadsheet') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
    return 'Tabelle';
  }
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return 'Dokument';
  }
  if (mimeType.includes('zip') || fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
    return 'Archiv';
  }
  return 'Datei';
}

export function getLinkBadges(document: OrganizationDocument): string[] {
  return document.links.map((link) => {
    if (link.jobId) {
      return link.jobNumber
        ? `Auftrag ${link.jobNumber}`
        : link.jobTitle
          ? `Auftrag: ${link.jobTitle}`
          : 'Auftrag';
    }

    if (link.clientId) {
      return link.clientName ? `Kunde: ${link.clientName}` : 'Kunde';
    }

    if (link.employeeId) {
      return link.employeeName ? `Mitarbeiter: ${link.employeeName}` : 'Mitarbeiter';
    }

    if (link.requestId) {
      return link.requestNumber ? `Anfrage ${link.requestNumber}` : 'Anfrage';
    }

    if (link.equipmentId) {
      return link.equipmentNumber
        ? `Anlage ${link.equipmentNumber}`
        : link.equipmentName
          ? `Anlage: ${link.equipmentName}`
          : 'Anlage';
    }

    if (link.serviceCaseId) {
      return link.serviceCaseNumber ? `Servicefall ${link.serviceCaseNumber}` : 'Servicefall';
    }

    if (link.maintenanceCoverageId) {
      return link.maintenanceCoverageNumber ? `Abdeckung ${link.maintenanceCoverageNumber}` : 'Abdeckung';
    }

    return link.projectNumber
      ? `Projekt ${link.projectNumber}`
      : link.projectName
        ? `Projekt: ${link.projectName}`
        : 'Projekt';
  });
}

export function getAuditEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    uploaded: 'Hochgeladen',
    renamed: 'Umbenannt',
    moved: 'Verschoben',
    copied: 'Kopiert',
    category_changed: 'Kategorie geändert',
    linked: 'Verknüpft',
    unlinked: 'Verknüpfung entfernt',
    deleted: 'In den Papierkorb verschoben',
    restored: 'Wiederhergestellt',
    version_uploaded: 'Neue Version hochgeladen',
    permanently_deleted: 'Endgültig gelöscht',
    storage_cleanup: 'Speicher bereinigt',
    retention_changed: 'Aufbewahrung geändert',
    filed: 'Festgeschrieben',
    origin_changed: 'Herkunft geändert',
  };

  return labels[eventType] ?? 'Dokumentaktion';
}

/**
 * The archive state in a few words for a library row, such as „Festgeschrieben,
 * aufbewahren bis 31.12.2036"; null for an unfiled document without a period.
 */
export function getArchiveLabel(archive: DocumentArchive | null): string | null {
  if (!archive) return null;
  const endsOn = archive.retentionEndsOn ? formatGermanDate(archive.retentionEndsOn) : null;
  if (archive.filedAt) return endsOn ? `Festgeschrieben, aufbewahren bis ${endsOn}` : 'Festgeschrieben';
  return endsOn ? `Aufbewahren bis ${endsOn}` : null;
}

/**
 * Where a legacy original came from, for a library row, such as „Aus Sykasoft:
 * RE-2019-0042“; null for a document without an origin.
 */
export function getOriginLabel(origin: DocumentOrigin): string | null {
  const { sourceSystem, sourceReference } = origin;
  if (sourceSystem && sourceReference) return `Aus ${sourceSystem}: ${sourceReference}`;
  if (sourceReference) return `Alte Nummer: ${sourceReference}`;
  return sourceSystem ? `Aus ${sourceSystem}` : null;
}
