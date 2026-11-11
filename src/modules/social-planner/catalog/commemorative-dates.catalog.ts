import type { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';

/**
 * The business-mode keys as plain strings.
 *
 * `LeadFlowBusinessMode` is a TypeScript enum, so its members are not
 * interchangeable with the string literals a catalog like this wants to be
 * written in. Taking `${LeadFlowBusinessMode}` keeps the two bound — adding a
 * 13th mode to the enum immediately widens this type — while letting the rows
 * below stay readable, and while keeping the Planner's stored/HTTP vocabulary
 * a string rather than a LeadFlow enum import.
 */
export type SocialBusinessModeKey = `${LeadFlowBusinessMode}`;

/**
 * The commemorative-date catalog the Planner offers when an operator asks the
 * AI to build a plan around seasonal moments.
 *
 * WHY RULES AND NOT DATES
 * -----------------------
 * The obvious shape for this file is a list of dates per year, refreshed every
 * December. That shape is wrong for two reasons. It rots silently — the first
 * week of a year where nobody remembered to add the rows, the feature simply
 * returns nothing and looks broken rather than unmaintained. And it cannot
 * answer a question about a period that spans a year boundary, which a quarterly
 * plan routinely does.
 *
 * Every moving date in this catalog is actually a rule, so it is stored as one:
 *
 *   - `fixed`    — same month and day every year (Christmas, New Year);
 *   - `weekday`  — the Nth weekday of a month, counting from the start or,
 *                  with a negative ordinal, from the end (Mother's Day is the
 *                  2nd Sunday of May; Black Friday is the day after the 4th
 *                  Thursday of November);
 *   - `easter`   — a fixed offset in days from Easter Sunday, which is itself
 *                  computed (Carnival is Easter minus 47, Good Friday minus 2,
 *                  Corpus Christi plus 60).
 *
 * With those three shapes the catalog resolves 2026 and 2040 equally well and
 * no scheduled job has to keep it alive.
 *
 * WHAT "NATIONAL" MEANS HERE
 * --------------------------
 * `significance: 'national'` marks the dates an ordinary person in that country
 * observes — Christmas, Mother's Day, Independence Day. `commercial` marks
 * retail moments (Black Friday, Consumer Day) and `sector` marks dates that
 * only matter to some businesses (Dentist Day, Architect Day). The UI gives
 * national dates visual weight; the distinction is made here, once, so the
 * client does not have to hardcode a list of "important" names.
 *
 * BUSINESS MODES
 * --------------
 * `businessModes: null` means the date is relevant to everyone. A non-null list
 * narrows it. Deliberately conservative: a date is tagged to a mode only when a
 * business of that kind would plausibly post about it, because an over-tagged
 * catalog produces a plan full of irrelevant seasonal posts, which is worse
 * than a catalog that offers fewer.
 */

export type CommemorativeDateSignificance =
  | 'national'
  | 'commercial'
  | 'sector';

export type CommemorativeDateRule =
  | { kind: 'fixed'; month: number; day: number }
  | {
      kind: 'weekday';
      month: number;
      /** 1 = Sunday .. 7 = Saturday, matching ISO-ish reading order. */
      weekday: number;
      /** 1..5 counts from the start of the month; -1 counts from the end. */
      ordinal: number;
      /** Days added after the resolved weekday. Black Friday is Thanksgiving + 1. */
      offsetDays?: number;
    }
  | { kind: 'easter'; offsetDays: number };

export interface CommemorativeDateCatalogItem {
  /** Stable across years and countries; the id the client sends back. */
  key: string;
  label: string;
  /** ISO 3166-1 alpha-2, or 'GLOBAL' for dates observed everywhere. */
  country: string;
  significance: CommemorativeDateSignificance;
  rule: CommemorativeDateRule;
  /** NULL means every business mode. */
  businessModes: SocialBusinessModeKey[] | null;
}

/**
 * Easter Sunday for a Gregorian year, by the Meeus/Jones/Butcher algorithm.
 *
 * This is the anchor for Carnival, Good Friday and Corpus Christi, which is why
 * a date library is not pulled in for it: the computation is exact, has no
 * timezone dimension, and is the only astronomical rule the catalog needs.
 */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Compact constructors for the fixed-day sector and commercial rows. The
 * country is assigned where they are spread into the catalog (`br_` keys are
 * Brazilian, the rest are international observances).
 */
function sectorDate(
  key: string,
  label: string,
  month: number,
  day: number,
  businessModes: SocialBusinessModeKey[] | null,
): Omit<CommemorativeDateCatalogItem, 'country'> {
  return { key, label, significance: 'sector', rule: { kind: 'fixed', month, day }, businessModes };
}

function commercialDate(
  key: string,
  label: string,
  month: number,
  day: number,
  businessModes: SocialBusinessModeKey[] | null,
): Omit<CommemorativeDateCatalogItem, 'country'> {
  return { ...sectorDate(key, label, month, day, businessModes), significance: 'commercial' };
}

/**
 * The catalog itself.
 *
 * Scope of this etapa: GLOBAL dates plus Brazil and the United States in full.
 * Other American countries resolve their GLOBAL dates and their own national
 * holidays are a follow-up — stated plainly here so nobody reads the short
 * per-country lists as an accident.
 */
export const COMMEMORATIVE_DATES: CommemorativeDateCatalogItem[] = [
  // ---------------------------------------------------------------- GLOBAL --
  {
    key: 'new_year',
    label: 'Ano Novo',
    country: 'GLOBAL',
    significance: 'national',
    rule: { kind: 'fixed', month: 1, day: 1 },
    businessModes: null,
  },
  {
    key: 'christmas',
    label: 'Natal',
    country: 'GLOBAL',
    significance: 'national',
    rule: { kind: 'fixed', month: 12, day: 25 },
    businessModes: null,
  },
  {
    key: 'christmas_eve',
    label: 'Véspera de Natal',
    country: 'GLOBAL',
    significance: 'national',
    rule: { kind: 'fixed', month: 12, day: 24 },
    businessModes: null,
  },
  {
    key: 'valentines_international',
    label: 'Dia dos Namorados (internacional)',
    country: 'GLOBAL',
    significance: 'commercial',
    rule: { kind: 'fixed', month: 2, day: 14 },
    businessModes: null,
  },
  {
    key: 'international_womens_day',
    label: 'Dia Internacional da Mulher',
    country: 'GLOBAL',
    significance: 'national',
    rule: { kind: 'fixed', month: 3, day: 8 },
    businessModes: null,
  },
  {
    key: 'easter',
    label: 'Páscoa',
    country: 'GLOBAL',
    significance: 'national',
    rule: { kind: 'easter', offsetDays: 0 },
    businessModes: null,
  },
  {
    key: 'good_friday',
    label: 'Sexta-feira Santa',
    country: 'GLOBAL',
    significance: 'national',
    rule: { kind: 'easter', offsetDays: -2 },
    businessModes: null,
  },
  {
    key: 'environment_day',
    label: 'Dia Mundial do Meio Ambiente',
    country: 'GLOBAL',
    significance: 'sector',
    rule: { kind: 'fixed', month: 6, day: 5 },
    businessModes: ['agency_services', 'local_services', 'retail_store'],
  },
  {
    key: 'black_friday',
    label: 'Black Friday',
    country: 'GLOBAL',
    significance: 'commercial',
    // The day after the 4th Thursday of November, which is Thanksgiving in the
    // US and the anchor the date inherited everywhere else.
    rule: { kind: 'weekday', month: 11, weekday: 5, ordinal: 4, offsetDays: 1 },
    businessModes: null,
  },
  {
    key: 'cyber_monday',
    label: 'Cyber Monday',
    country: 'GLOBAL',
    significance: 'commercial',
    rule: { kind: 'weekday', month: 11, weekday: 5, ordinal: 4, offsetDays: 4 },
    businessModes: [
      'ecommerce_light',
      'retail_store',
      'education_courses',
      'agency_services',
    ],
  },

  // ---------------------------------------------------------------- BRAZIL --
  {
    key: 'br_carnival',
    label: 'Carnaval',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'easter', offsetDays: -47 },
    businessModes: null,
  },
  {
    key: 'br_corpus_christi',
    label: 'Corpus Christi',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'easter', offsetDays: 60 },
    businessModes: null,
  },
  {
    key: 'br_tiradentes',
    label: 'Tiradentes',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'fixed', month: 4, day: 21 },
    businessModes: null,
  },
  {
    key: 'br_labour_day',
    label: 'Dia do Trabalhador',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'fixed', month: 5, day: 1 },
    businessModes: null,
  },
  {
    key: 'br_mothers_day',
    label: 'Dia das Mães',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'weekday', month: 5, weekday: 1, ordinal: 2 },
    businessModes: null,
  },
  {
    key: 'br_valentines',
    label: 'Dia dos Namorados',
    country: 'BR',
    significance: 'commercial',
    rule: { kind: 'fixed', month: 6, day: 12 },
    businessModes: null,
  },
  {
    key: 'br_fathers_day',
    label: 'Dia dos Pais',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'weekday', month: 8, weekday: 1, ordinal: 2 },
    businessModes: null,
  },
  {
    key: 'br_independence',
    label: 'Independência do Brasil',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'fixed', month: 9, day: 7 },
    businessModes: null,
  },
  {
    key: 'br_our_lady_aparecida',
    label: 'Nossa Senhora Aparecida',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'fixed', month: 10, day: 12 },
    businessModes: null,
  },
  {
    key: 'br_childrens_day',
    label: 'Dia das Crianças',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'fixed', month: 10, day: 12 },
    businessModes: null,
  },
  {
    key: 'br_teachers_day',
    label: 'Dia do Professor',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 10, day: 15 },
    businessModes: ['education_courses'],
  },
  {
    key: 'br_all_souls',
    label: 'Finados',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'fixed', month: 11, day: 2 },
    businessModes: null,
  },
  {
    key: 'br_republic',
    label: 'Proclamação da República',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'fixed', month: 11, day: 15 },
    businessModes: null,
  },
  {
    key: 'br_black_awareness',
    label: 'Dia da Consciência Negra',
    country: 'BR',
    significance: 'national',
    rule: { kind: 'fixed', month: 11, day: 20 },
    businessModes: null,
  },
  {
    key: 'br_consumer_day',
    label: 'Dia do Consumidor',
    country: 'BR',
    significance: 'commercial',
    rule: { kind: 'fixed', month: 3, day: 15 },
    businessModes: [
      'ecommerce_light',
      'retail_store',
      'agency_services',
      'local_services',
    ],
  },
  {
    key: 'br_client_day',
    label: 'Dia do Cliente',
    country: 'BR',
    significance: 'commercial',
    rule: { kind: 'fixed', month: 9, day: 15 },
    businessModes: null,
  },
  {
    key: 'br_secretary_day',
    label: 'Dia da Secretária',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 9, day: 30 },
    businessModes: ['agency_services', 'legal_accounting'],
  },
  {
    key: 'br_doctor_day',
    label: 'Dia do Médico',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 10, day: 18 },
    businessModes: ['clinics_esthetics'],
  },
  {
    key: 'br_dentist_day',
    label: 'Dia do Dentista',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 10, day: 25 },
    businessModes: ['clinics_esthetics'],
  },
  {
    key: 'br_architect_day',
    label: 'Dia do Arquiteto',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 12, day: 15 },
    businessModes: ['local_services', 'real_estate'],
  },
  {
    key: 'br_lawyer_day',
    label: 'Dia do Advogado',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 8, day: 11 },
    businessModes: ['legal_accounting'],
  },
  {
    key: 'br_accountant_day',
    label: 'Dia do Contador',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 9, day: 22 },
    businessModes: ['legal_accounting'],
  },
  {
    key: 'br_nutritionist_day',
    label: 'Dia do Nutricionista',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 8, day: 31 },
    businessModes: ['fitness_wellness', 'clinics_esthetics'],
  },
  {
    key: 'br_physical_education_day',
    label: 'Dia do Profissional de Educação Física',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 9, day: 1 },
    businessModes: ['fitness_wellness'],
  },
  {
    key: 'br_realtor_day',
    label: 'Dia do Corretor de Imóveis',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 8, day: 27 },
    businessModes: ['real_estate'],
  },
  {
    key: 'br_gastronomy_day',
    label: 'Dia da Gastronomia',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 10, day: 24 },
    businessModes: ['restaurants_food'],
  },
  {
    key: 'br_tourism_day',
    label: 'Dia Mundial do Turismo',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 9, day: 27 },
    businessModes: ['events_tourism'],
  },
  {
    key: 'br_mechanic_day',
    label: 'Dia do Mecânico',
    country: 'BR',
    significance: 'sector',
    rule: { kind: 'fixed', month: 10, day: 28 },
    businessModes: ['automotive'],
  },

  // ------------------------------------------- BRAZIL: sector depth (2026-11) --
  // Every business mode gets dates of its own beyond the national calendar.
  // Same conservative tagging rule as above: only modes that would post.
  ...[
    // Agency / marketing
    sectorDate('br_advertiser_day', 'Dia do Publicitário', 2, 1, ['agency_services']),
    sectorDate('br_journalist_day', 'Dia do Jornalista', 4, 7, ['agency_services']),
    sectorDate('world_creativity_day', 'Dia Mundial da Criatividade e Inovação', 4, 21, ['agency_services', 'education_courses']),
    sectorDate('br_marketing_day', 'Dia do Profissional de Marketing', 5, 8, ['agency_services']),
    sectorDate('internet_day', 'Dia da Internet', 5, 17, ['agency_services', 'ecommerce_light']),
    sectorDate('social_media_day', 'Dia Mundial das Redes Sociais', 6, 30, ['agency_services', 'ecommerce_light']),
    sectorDate('world_photography_day', 'Dia Mundial da Fotografia', 8, 19, ['agency_services', 'events_tourism']),
    sectorDate('br_designer_day', 'Dia do Designer', 11, 5, ['agency_services']),
    // Small business / local services / retail
    sectorDate('br_small_business_day', 'Dia da Micro e Pequena Empresa', 10, 5, ['local_services', 'retail_store', 'agency_services', 'legal_accounting']),
    sectorDate('br_electrician_day', 'Dia do Eletricista', 10, 17, ['local_services']),
    sectorDate('br_merchant_day', 'Dia do Comerciante', 7, 16, ['retail_store', 'local_services']),
    commercialDate('br_grandparents_day', 'Dia dos Avós', 7, 26, ['retail_store', 'ecommerce_light', 'restaurants_food']),
    // Health / clinics / wellness
    sectorDate('world_physical_activity_day', 'Dia Mundial da Atividade Física', 4, 6, ['fitness_wellness']),
    sectorDate('world_health_day', 'Dia Mundial da Saúde', 4, 7, ['clinics_esthetics', 'fitness_wellness']),
    sectorDate('nursing_day', 'Dia da Enfermagem', 5, 12, ['clinics_esthetics']),
    sectorDate('yoga_day', 'Dia Internacional do Yoga', 6, 21, ['fitness_wellness']),
    sectorDate('br_psychologist_day', 'Dia do Psicólogo', 8, 27, ['clinics_esthetics', 'fitness_wellness']),
    sectorDate('br_yellow_september', 'Início do Setembro Amarelo', 9, 1, ['clinics_esthetics', 'fitness_wellness']),
    sectorDate('world_heart_day', 'Dia Mundial do Coração', 9, 29, ['fitness_wellness', 'clinics_esthetics']),
    sectorDate('br_pink_october', 'Início do Outubro Rosa', 10, 1, ['clinics_esthetics', 'fitness_wellness']),
    sectorDate('br_physiotherapist_day', 'Dia do Fisioterapeuta', 10, 13, ['clinics_esthetics', 'fitness_wellness']),
    sectorDate('br_blue_november', 'Início do Novembro Azul', 11, 1, ['clinics_esthetics', 'fitness_wellness']),
    // Food
    sectorDate('br_barbecue_day', 'Dia do Churrasco', 4, 24, ['restaurants_food']),
    sectorDate('br_coffee_day', 'Dia Nacional do Café', 5, 24, ['restaurants_food']),
    sectorDate('burger_day', 'Dia do Hambúrguer', 5, 28, ['restaurants_food']),
    sectorDate('world_chocolate_day', 'Dia Mundial do Chocolate', 7, 7, ['restaurants_food', 'retail_store']),
    sectorDate('br_pizza_day', 'Dia da Pizza', 7, 10, ['restaurants_food']),
    sectorDate('br_waiter_day', 'Dia do Garçom', 8, 11, ['restaurants_food']),
    sectorDate('world_food_day', 'Dia Mundial da Alimentação', 10, 16, ['restaurants_food', 'fitness_wellness']),
    // Real estate
    { ...sectorDate('world_habitat_day', 'Dia Mundial do Habitat', 10, 1, ['real_estate']), rule: { kind: 'weekday' as const, month: 10, weekday: 2, ordinal: 1 } },
    sectorDate('br_engineer_day', 'Dia do Engenheiro', 12, 11, ['real_estate']),
    // Education
    sectorDate('world_book_day', 'Dia Mundial do Livro', 4, 23, ['education_courses']),
    sectorDate('br_education_day', 'Dia da Educação', 4, 28, ['education_courses']),
    sectorDate('br_student_day', 'Dia do Estudante', 8, 11, ['education_courses']),
    // Automotive
    sectorDate('br_yellow_may', 'Início do Maio Amarelo', 5, 1, ['automotive']),
    sectorDate('br_driver_day', 'Dia do Motorista', 7, 25, ['automotive']),
    sectorDate('br_motorcyclist_day', 'Dia do Motociclista', 7, 27, ['automotive']),
    sectorDate('br_traffic_day', 'Dia Nacional do Trânsito', 9, 25, ['automotive']),
    // Events / tourism
    sectorDate('br_national_tourism_day', 'Dia Nacional do Turismo', 5, 8, ['events_tourism']),
    commercialDate('br_sao_joao', 'São João (Festas Juninas)', 6, 24, null),
    // Legal / accounting
    sectorDate('br_taxpayer_day', 'Dia do Contribuinte', 5, 25, ['legal_accounting']),
    sectorDate('br_administrator_day', 'Dia do Administrador', 9, 9, ['legal_accounting']),
    sectorDate('br_justice_day', 'Dia da Justiça', 12, 8, ['legal_accounting']),
  ].map((item) => ({ ...item, country: item.key.startsWith('br_') ? 'BR' : 'GLOBAL' })),
  {
    key: 'new_years_eve',
    label: 'Véspera de Ano Novo',
    country: 'GLOBAL',
    significance: 'national',
    rule: { kind: 'fixed', month: 12, day: 31 },
    businessModes: null,
  },
  {
    key: 'singles_day',
    label: '11.11 (Singles Day)',
    country: 'GLOBAL',
    significance: 'commercial',
    rule: { kind: 'fixed', month: 11, day: 11 },
    businessModes: ['ecommerce_light', 'retail_store'],
  },

  // ------------------------------------------------------------------- US ---
  {
    key: 'us_mlk_day',
    label: 'Martin Luther King Jr. Day',
    country: 'US',
    significance: 'national',
    rule: { kind: 'weekday', month: 1, weekday: 2, ordinal: 3 },
    businessModes: null,
  },
  {
    key: 'us_presidents_day',
    label: "Presidents' Day",
    country: 'US',
    significance: 'national',
    rule: { kind: 'weekday', month: 2, weekday: 2, ordinal: 3 },
    businessModes: null,
  },
  {
    key: 'us_memorial_day',
    label: 'Memorial Day',
    country: 'US',
    significance: 'national',
    rule: { kind: 'weekday', month: 5, weekday: 2, ordinal: -1 },
    businessModes: null,
  },
  {
    key: 'us_mothers_day',
    label: "Mother's Day",
    country: 'US',
    significance: 'national',
    rule: { kind: 'weekday', month: 5, weekday: 1, ordinal: 2 },
    businessModes: null,
  },
  {
    key: 'us_fathers_day',
    label: "Father's Day",
    country: 'US',
    significance: 'national',
    rule: { kind: 'weekday', month: 6, weekday: 1, ordinal: 3 },
    businessModes: null,
  },
  {
    key: 'us_juneteenth',
    label: 'Juneteenth',
    country: 'US',
    significance: 'national',
    rule: { kind: 'fixed', month: 6, day: 19 },
    businessModes: null,
  },
  {
    key: 'us_independence_day',
    label: 'Independence Day',
    country: 'US',
    significance: 'national',
    rule: { kind: 'fixed', month: 7, day: 4 },
    businessModes: null,
  },
  {
    key: 'us_labor_day',
    label: 'Labor Day',
    country: 'US',
    significance: 'national',
    rule: { kind: 'weekday', month: 9, weekday: 2, ordinal: 1 },
    businessModes: null,
  },
  {
    key: 'us_veterans_day',
    label: 'Veterans Day',
    country: 'US',
    significance: 'national',
    rule: { kind: 'fixed', month: 11, day: 11 },
    businessModes: null,
  },
  {
    key: 'us_thanksgiving',
    label: 'Thanksgiving',
    country: 'US',
    significance: 'national',
    rule: { kind: 'weekday', month: 11, weekday: 5, ordinal: 4 },
    businessModes: null,
  },
  {
    key: 'us_halloween',
    label: 'Halloween',
    country: 'US',
    significance: 'commercial',
    rule: { kind: 'fixed', month: 10, day: 31 },
    businessModes: null,
  },
  {
    key: 'us_small_business_saturday',
    label: 'Small Business Saturday',
    country: 'US',
    significance: 'commercial',
    rule: { kind: 'weekday', month: 11, weekday: 5, ordinal: 4, offsetDays: 2 },
    businessModes: ['retail_store', 'restaurants_food', 'local_services'],
  },
  {
    key: 'us_super_bowl',
    label: 'Super Bowl Sunday',
    country: 'US',
    significance: 'commercial',
    rule: { kind: 'weekday', month: 2, weekday: 1, ordinal: 2 },
    businessModes: ['restaurants_food', 'retail_store', 'events_tourism'],
  },
];
