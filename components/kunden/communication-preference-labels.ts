import type {
  CommunicationChannel,
  CommunicationPreferenceState,
  CommunicationPurpose,
} from '@/lib/customer-relationships/types';

export const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  phone: 'Telefon',
  email: 'E-Mail',
  sms: 'SMS',
  letter: 'Brief',
  in_person: 'Persönlich',
};

export const PURPOSE_LABELS: Record<CommunicationPurpose, string> = {
  appointment_service: 'Termin und Service',
  marketing: 'Marketing',
  commercial_required: 'Erforderliche kaufmännische Kommunikation',
};

export const STATE_LABELS: Record<CommunicationPreferenceState, string> = {
  allowed: 'Erlaubt',
  disallowed: 'Nicht erlaubt',
  unknown: 'Unbekannt',
};

export function isCommunicationChannel(value: string): value is CommunicationChannel {
  return Object.hasOwn(CHANNEL_LABELS, value);
}

export function isCommunicationPurpose(value: string): value is CommunicationPurpose {
  return Object.hasOwn(PURPOSE_LABELS, value);
}

export function isCommunicationPreferenceState(value: string): value is CommunicationPreferenceState {
  return Object.hasOwn(STATE_LABELS, value);
}
