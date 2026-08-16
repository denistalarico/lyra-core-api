import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';

/**
 * Ready-made agenda copy, per niche.
 *
 * A reminder is the one message where the generic version is visibly wrong: a
 * clinic confirms a *consulta*, a restaurant a *reserva*, an agency a *reunião*.
 * The operator could write all three by hand, but then every workspace starts
 * from an empty box and the variables — the part that actually makes the message
 * useful — have to be discovered.
 *
 * So the Business Mode, which already carries the vocabulary of the niche
 * (`business-mode-templates.catalog.ts`), also brings the first draft. It is a
 * *default*, applied when the automation is provisioned: the text is stored on
 * the instance and the operator edits it freely from there. Changing the copy
 * here never rewrites an automation that already exists.
 */

export type AppointmentCopyRecipeKey =
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'appointment_no_show_recovery';

type CopySet = Record<AppointmentCopyRecipeKey, string>;

/**
 * The three sentences of a niche, built from the one word that differs.
 *
 * Written as a function rather than thirty hand-typed strings because the
 * difference between niches really is that word: keeping it this way is what
 * stops a niche's confirmation drifting from its own reminder, and what makes
 * the variable set identical everywhere.
 */
function copyFor(input: {
  /** What the commitment is called here: consulta, reserva, visita… */
  noun: string;
  /** Grammatical gender of that noun, which the contractions follow. */
  gender: 'f' | 'm';
}): CopySet {
  const { noun } = input;
  const possessive = input.gender === 'f' ? 'sua' : 'seu';
  const of = input.gender === 'f' ? 'da' : 'do';
  const at = input.gender === 'f' ? 'na' : 'no';

  return {
    appointment_reminder:
      `Oi {{contact.firstName}}! Passando para lembrar ${of} ${possessive} ${noun}: ` +
      `{{appointment.title}}, {{appointment.weekday}} ({{appointment.date}}) às {{appointment.time}}. ` +
      `Se precisar remarcar, é só responder por aqui.`,
    appointment_confirmation:
      `Oi {{contact.firstName}}! Podemos confirmar ${possessive} ${noun} de {{appointment.title}}, ` +
      `{{appointment.weekday}} ({{appointment.date}}) às {{appointment.time}}? ` +
      `Responda Confirmar, Reagendar ou Cancelar.`,
    appointment_no_show_recovery:
      `Oi {{contact.firstName}}! Sentimos sua falta ${at} ${possessive} ${noun} de {{appointment.title}}, ` +
      `{{appointment.weekday}} às {{appointment.time}}. ` +
      `Quer remarcar? Responda por aqui que eu ajudo.`,
  };
}

/**
 * Only the modes that run an agenda appear here — the same list as
 * `AGENDA_MODES` in the recipe catalog. A mode absent from both never sees
 * these recipes at all.
 */
const COPY_BY_MODE: Partial<Record<LeadFlowBusinessMode, CopySet>> = {
  [LeadFlowBusinessMode.ClinicsEsthetics]: copyFor({
    noun: 'consulta',
    gender: 'f',
  }),
  [LeadFlowBusinessMode.RestaurantsFood]: copyFor({
    noun: 'reserva',
    gender: 'f',
  }),
  [LeadFlowBusinessMode.RealEstate]: copyFor({ noun: 'visita', gender: 'f' }),
  [LeadFlowBusinessMode.EducationCourses]: copyFor({
    noun: 'aula',
    gender: 'f',
  }),
  [LeadFlowBusinessMode.Automotive]: copyFor({
    noun: 'agendamento',
    gender: 'm',
  }),
  [LeadFlowBusinessMode.LocalServices]: copyFor({
    noun: 'atendimento',
    gender: 'm',
  }),
  [LeadFlowBusinessMode.LegalAccounting]: copyFor({
    noun: 'reunião',
    gender: 'f',
  }),
  [LeadFlowBusinessMode.FitnessWellness]: copyFor({
    noun: 'aula',
    gender: 'f',
  }),
  [LeadFlowBusinessMode.EventsTourism]: copyFor({
    noun: 'reserva',
    gender: 'f',
  }),
  [LeadFlowBusinessMode.AgencyServices]: copyFor({
    noun: 'reunião',
    gender: 'f',
  }),
};

export function isAppointmentCopyRecipeKey(
  value: string,
): value is AppointmentCopyRecipeKey {
  return (
    value === 'appointment_reminder' ||
    value === 'appointment_confirmation' ||
    value === 'appointment_no_show_recovery'
  );
}

/**
 * The first draft for this recipe in this niche, or `null` when there is none —
 * in which case the recipe's own generic copy stands.
 */
export function appointmentMessageCopy(
  recipeKey: string,
  businessModeKey: string | null | undefined,
): string | null {
  if (!isAppointmentCopyRecipeKey(recipeKey)) return null;
  const mode = COPY_BY_MODE[businessModeKey as LeadFlowBusinessMode];
  return mode ? mode[recipeKey] : null;
}
