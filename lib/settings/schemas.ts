import { z } from 'zod';

export const profileSettingsSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'Bitte gib einen Vornamen ein.')
    .max(80, 'Der Vorname darf maximal 80 Zeichen lang sein.'),
  lastName: z
    .string()
    .trim()
    .min(1, 'Bitte gib einen Nachnamen ein.')
    .max(80, 'Der Nachname darf maximal 80 Zeichen lang sein.')
});

export type ProfileSettingsValues = z.infer<typeof profileSettingsSchema>;
