import { z } from 'zod';

export const profileSettingsSchema = z.object({
  firstName: z.string().trim().min(1, 'Bitte gib einen Vornamen ein.').max(80),
  lastName: z.string().trim().min(1, 'Bitte gib einen Nachnamen ein.').max(80),
});

export type ProfileSettingsValues = z.infer<typeof profileSettingsSchema>;
