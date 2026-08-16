/**
 * The variables an agenda message may carry.
 *
 * Until now every automation sent `messageConfig.baseMessage` literally, which
 * is why the agenda copy could only ever be generic: a reminder that cannot say
 * *when* is a reminder about nothing. The vocabulary is deliberately closed and
 * small — each entry is a value the platform can actually resolve from the
 * commitment, so a message can never promise data that does not exist.
 *
 * The syntax is the one the product already uses in Contracts
 * (`contracts/contracts-template-content.ts`): `{{namespace.field}}`.
 *
 * A note on "especialidade", which is the example everyone reaches for: the
 * Agenda has no specialty and no service field. `serviceRef` in the automation
 * context is the scheduled item's `type` (`event` | `meeting` | `call`), which
 * says nothing to a lead. What was actually booked is the commitment's title,
 * and that is what {@link APPOINTMENT_MESSAGE_VARIABLES} exposes.
 */

export type AppointmentMessageVariableKey =
  | 'contact.firstName'
  | 'appointment.title'
  | 'appointment.date'
  | 'appointment.time'
  | 'appointment.weekday'
  | 'appointment.location'
  | 'appointment.professional'
  | 'business.name';

export interface AppointmentMessageVariableSpec {
  key: AppointmentMessageVariableKey;
  label: string;
  /** What it resolves to, in the operator's words. */
  description: string;
  /** Shown in the preview and in the WhatsApp template guide. */
  example: string;
}

export const APPOINTMENT_MESSAGE_VARIABLES: readonly AppointmentMessageVariableSpec[] =
  [
    {
      key: 'contact.firstName',
      label: 'Primeiro nome do contato',
      description: 'O primeiro nome de quem agendou.',
      example: 'Marina',
    },
    {
      key: 'appointment.title',
      label: 'O que foi agendado',
      description:
        'O título do compromisso na Agenda — é o campo que descreve o serviço, a consulta ou a reunião.',
      example: 'Avaliação estética',
    },
    {
      key: 'appointment.date',
      label: 'Data',
      description: 'Data do compromisso no fuso dele (dd/mm).',
      example: '12/09',
    },
    {
      key: 'appointment.time',
      label: 'Horário',
      description: 'Horário do compromisso no fuso dele (hh:mm).',
      example: '14:30',
    },
    {
      key: 'appointment.weekday',
      label: 'Dia da semana',
      description: 'Dia da semana do compromisso, por extenso.',
      example: 'quinta-feira',
    },
    {
      key: 'appointment.location',
      label: 'Local',
      description:
        'Endereço do compromisso; quando é online, o link da reunião. Vazio quando nenhum dos dois foi informado.',
      example: 'Rua das Acácias, 120',
    },
    {
      key: 'appointment.professional',
      label: 'Responsável',
      description:
        'Quem vai atender, quando o compromisso tem um responsável definido.',
      example: 'Dra. Helena',
    },
    {
      key: 'business.name',
      label: 'Nome do negócio',
      description: 'O nome público configurado no contexto do LeadFlow.',
      example: 'Clínica Aurora',
    },
  ];

export const APPOINTMENT_MESSAGE_VARIABLE_KEYS: readonly AppointmentMessageVariableKey[] =
  APPOINTMENT_MESSAGE_VARIABLES.map((variable) => variable.key);

const KEY_SET = new Set<string>(APPOINTMENT_MESSAGE_VARIABLE_KEYS);

export function isAppointmentMessageVariableKey(
  value: unknown,
): value is AppointmentMessageVariableKey {
  return typeof value === 'string' && KEY_SET.has(value);
}

export function appointmentMessageVariable(
  key: string,
): AppointmentMessageVariableSpec | undefined {
  return APPOINTMENT_MESSAGE_VARIABLES.find((variable) => variable.key === key);
}

/** `{{ namespace.field }}` — whitespace tolerated, one dotted segment only. */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][\w]*\.[a-zA-Z][\w]*)\s*\}\}/g;

/**
 * The known variables a text uses, in order of first appearance.
 *
 * Order is the whole point for WhatsApp: the provider only accepts positional
 * `{{1}}…{{n}}` parameters, so "which variable is number one" has to be a fact
 * about the text and not a separate list somebody keeps in sync by hand.
 * Unknown placeholders are ignored here and left untouched by
 * {@link renderAppointmentMessage} — a typo must be visible, not silently
 * deleted from the message.
 */
export function appointmentVariablesUsed(
  text: string | null | undefined,
): AppointmentMessageVariableKey[] {
  if (typeof text !== 'string' || !text) return [];
  const used: AppointmentMessageVariableKey[] = [];
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const key = match[1];
    if (isAppointmentMessageVariableKey(key) && !used.includes(key)) {
      used.push(key);
    }
  }
  return used;
}

export type AppointmentMessageValues = Partial<
  Record<AppointmentMessageVariableKey, string>
>;

/**
 * Replaces the known variables with their resolved values.
 *
 * A variable with no value collapses to an empty string and the sentence is
 * tidied afterwards, because "seu compromisso com  em " is worse than a shorter
 * sentence. Unknown placeholders survive untouched.
 */
export function renderAppointmentMessage(
  text: string,
  values: AppointmentMessageValues,
): string {
  const rendered = text.replace(VARIABLE_PATTERN, (whole, key: string) =>
    isAppointmentMessageVariableKey(key) ? (values[key] ?? '') : whole,
  );
  return tidy(rendered);
}

/**
 * The positional parameters for a WhatsApp template, in the declared order.
 *
 * Meta rejects an empty parameter, so a missing value becomes an em dash rather
 * than an empty string — the same reason the free-text path can afford to drop
 * it and this one cannot.
 */
export function appointmentTemplateParameters(
  orderedKeys: readonly string[],
  values: AppointmentMessageValues,
): string[] {
  return orderedKeys
    .filter(isAppointmentMessageVariableKey)
    .map((key) => values[key]?.trim() || '—');
}

/** Collapses the gaps an unresolved variable leaves behind. */
function tidy(value: string): string {
  return value
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
