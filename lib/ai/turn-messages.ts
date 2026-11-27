import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import type { AiTurnFailure } from '@/lib/ai/turn';

/** What a person reads when a turn ends early: stable German sentences, never a provider's words. */
export const AI_TURN_FAILURE_MESSAGES: Readonly<Record<AiTurnFailure, string>> = {
  step_limit: `${AI_PRODUCT_NAME} hat nach zu vielen Schritten angehalten. Stell die Frage bitte enger.`,
  disabled: `${AI_PRODUCT_NAME} wurde während der Antwort ausgeschaltet.`,
  undecidable: `${AI_PRODUCT_NAME} konnte nicht prüfen, ob sie weitermachen darf, und hat angehalten. Versuch es gleich noch einmal.`,
  input_too_large: 'Dieser Chat ist zu lang für eine weitere Antwort. Fang bitte einen neuen Chat an.',
  answer_too_long: 'Die Antwort wurde zu lang und ist hier abgeschnitten.',
  timeout: 'Die Antwort hat zu lange gedauert und wurde abgebrochen.',
  provider_refused: `${AI_PRODUCT_NAME} ist gerade nicht verfügbar. Wir kümmern uns darum.`,
  provider_unavailable: `${AI_PRODUCT_NAME} ist gerade nicht erreichbar. Versuch es in ein paar Minuten noch einmal.`,
  model_refused: `Dabei kann ${AI_PRODUCT_NAME} nicht helfen.`,
  interrupted: 'Die Antwort wurde unterbrochen. Versuch es noch einmal.',
  stopped: 'Du hast die Antwort angehalten.',
};
