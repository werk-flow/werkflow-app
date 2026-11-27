'use client';

import { FileText, Image as ImageIcon } from 'lucide-react';
import { memo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import type { AiChatFile } from '@/lib/ai/thread-types';
import { readInBackground } from '@/lib/data/background-read-client';
import { formatFileSize } from '@/lib/documents/format';
import { cn } from '@/lib/utils';

/** Type, size and pages of a file, as one line. */
export function fileFacts(file: Pick<AiChatFile, 'mimeType' | 'sizeBytes' | 'pages'>): string {
  const type = file.mimeType === 'application/pdf' ? 'PDF' : 'Bild';
  const pages = file.pages === null ? '' : ` · ${file.pages} ${file.pages === 1 ? 'Seite' : 'Seiten'}`;
  return `${type} · ${formatFileSize(file.sizeBytes)}${pages}`;
}

export function FileTypeIcon({ mimeType }: { mimeType: string }): React.JSX.Element {
  return mimeType === 'application/pdf' ? (
    <FileText className="size-5 shrink-0 text-muted-foreground" />
  ) : (
    <ImageIcon className="size-5 shrink-0 text-muted-foreground" />
  );
}

/**
 * Opens the file in a new tab through a ten-minute signed URL the server signs
 * at the tap (B11): the tab opens in the tap itself, so no pop-up blocker
 * stops it, and takes the address once it is signed. The bytes never pass
 * through the chat, and no address is kept.
 */
async function openFile(organizationId: string, fileId: string): Promise<string | null> {
  const tab = window.open('about:blank', '_blank');
  if (!tab) return 'Der Browser hat das Fenster blockiert. Erlaube Pop-ups und versuch es noch einmal.';
  tab.opener = null;
  const result = await readInBackground('ki-file-url', { organizationId, fileId });
  if (!result.success) {
    tab.close();
    return result.error === 'not_found'
      ? 'Diese Datei gibt es nicht mehr.'
      : 'Die Datei konnte nicht geöffnet werden. Versuch es noch einmal.';
  }
  tab.location.replace(result.url);
  return null;
}

/**
 * A file in the thread: the person's upload on their side, a file WerkFlow KI
 * made on its side, marked as a KI-Entwurf (B20). Its name is plain text, never
 * Markdown (B11).
 */
export const KiFileCard = memo(function KiFileCard({
  organizationId,
  file,
  unconfirmed,
}: {
  organizationId: string;
  file: AiChatFile;
  unconfirmed: boolean;
}): React.JSX.Element {
  const opening = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const made = file.origin === 'agent';
  return (
    <div className={cn('flex flex-col gap-1', made ? 'items-start' : 'items-end')}>
      <div className="flex w-full max-w-sm items-center gap-3 rounded-lg border bg-background px-3 py-2 shadow-xs">
        <FileTypeIcon mimeType={file.mimeType} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">{fileFacts(file)}</p>
          {made && <Badge variant="warning">KI-Entwurf</Badge>}
        </div>
        {/* An upload still on its way has no file item yet. */}
        {!unconfirmed && (
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-8"
            pending={opening.isPending}
            aria-label={`${file.name} öffnen`}
            onClick={() =>
              void opening.run(async () => {
                setError(null);
                setError(await openFile(organizationId, file.fileId));
              })
            }
          >
            Öffnen
          </Button>
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
});
