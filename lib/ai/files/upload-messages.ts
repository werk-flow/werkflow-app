import { describeFailure } from '@/lib/action-messages';
import { AI_UPLOAD_LIMITS } from '@/lib/ai/limits';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';

// What the composer says about a file it cannot take, in German.

const MEGABYTE = 1024 * 1024;

/** Why a file was refused, in German; the composer puts the file's name in front. */
const UPLOAD_MESSAGES: Readonly<Record<string, string>> = {
  file_type_not_allowed: 'Nur PDF, JPG, PNG und WebP gehen.',
  file_too_large: `Die Datei ist größer als ${AI_UPLOAD_LIMITS.maxFileBytes / MEGABYTE} MB.`,
  file_empty: 'Die Datei ist leer.',
  file_too_many_pages: `Die PDF hat mehr als ${AI_UPLOAD_LIMITS.maxPdfPages} Seiten.`,
  file_unreadable: 'Die Datei lässt sich nicht als PDF, JPG, PNG oder WebP lesen.',
  too_many_files: `Eine Nachricht nimmt höchstens ${AI_UPLOAD_LIMITS.maxFilesPerMessage} Dateien mit.`,
  message_too_large: `Die Dateien einer Nachricht dürfen zusammen höchstens ${AI_UPLOAD_LIMITS.maxMessageBytes / MEGABYTE} MB groß sein.`,
  too_many_unsent_files: `Du hast ${AI_UPLOAD_LIMITS.maxUnsentFiles} Dateien hochgeladen und noch nicht gesendet. Schick sie zuerst ab oder entferne sie.`,
  not_released: `${AI_PRODUCT_NAME} ist für deinen Betrieb nicht freigeschaltet.`,
};

export function describeUploadRefusal(fileName: string, code: string): string {
  const reason = describeFailure(
    code,
    UPLOAD_MESSAGES,
    'Die Datei konnte nicht hochgeladen werden. Versuch es noch einmal.',
  );
  return `„${fileName}“: ${reason}`;
}
