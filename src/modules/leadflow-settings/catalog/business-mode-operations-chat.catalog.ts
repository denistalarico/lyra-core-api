import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import type { LeadFlowJsonObject } from '../types/leadflow-settings.types';

export type LeadFlowOperationsChatAction = {
  key: string;
  intent: 'capacity_unavailable' | 'capacity_released';
  label: string;
  resourceKinds: string[];
  requiredFields: string[];
  examples: string[];
  owningCapability: 'agenda' | 'availability' | 'inventory';
};

export type LeadFlowOperationsChatCatalog = {
  version: 1;
  readIntents: string[];
  writeIntents: string[];
  modeActions: LeadFlowOperationsChatAction[];
};

const READ_INTENTS = [
  'kpi_overview',
  'conversations',
  'agent_performance',
  'handoffs',
  'general_report',
];

const WRITE_INTENTS = [
  'update_offer_price',
  'schedule_discount',
  'add_closure',
  'update_business_hours',
  'capacity_unavailable',
  'capacity_released',
];

const MODE_ACTIONS: Record<
  LeadFlowBusinessMode,
  LeadFlowOperationsChatAction[]
> = {
  [LeadFlowBusinessMode.AgencyServices]: pair({
    keys: ['diagnostic_capacity_full', 'diagnostic_slot_released'],
    labels: [
      'Agenda de diagnósticos lotada',
      'Horário de diagnóstico liberado',
    ],
    resources: ['diagnostic', 'specialist_slot'],
    examples: [
      'A agenda de diagnósticos desta semana lotou',
      'Liberou um diagnóstico sexta às 15h',
    ],
    owner: 'agenda',
  }),
  [LeadFlowBusinessMode.LocalServices]: pair({
    keys: ['service_capacity_full', 'service_slot_released'],
    labels: ['Capacidade de atendimento esgotada', 'Vaga de serviço liberada'],
    resources: ['service', 'technician', 'service_area', 'time_slot'],
    examples: [
      'Não temos mais vagas de atendimento hoje',
      'Liberou uma vaga sexta às 15h',
    ],
    owner: 'availability',
  }),
  [LeadFlowBusinessMode.ClinicsEsthetics]: pair({
    keys: ['clinical_capacity_full', 'clinical_slot_released'],
    labels: ['Agenda clínica lotada', 'Horário clínico liberado'],
    resources: ['procedure', 'professional', 'room', 'time_slot'],
    examples: [
      'As avaliações de sexta acabaram',
      'Liberou uma avaliação sexta às 15h',
    ],
    owner: 'agenda',
  }),
  [LeadFlowBusinessMode.RestaurantsFood]: pair({
    keys: ['reservation_capacity_full', 'table_capacity_released'],
    labels: ['Reservas esgotadas', 'Mesa ou reserva liberada'],
    resources: ['table', 'service_period', 'party_size', 'menu_item'],
    examples: [
      'As reservas de sábado acabaram',
      'Liberou uma mesa sexta às 15h para quatro pessoas',
    ],
    owner: 'availability',
  }),
  [LeadFlowBusinessMode.RealEstate]: pair({
    keys: ['property_unavailable', 'visit_slot_released'],
    labels: ['Imóvel indisponível', 'Visita liberada'],
    resources: ['property', 'broker', 'visit_slot'],
    examples: [
      'O apartamento Jardins não está mais disponível',
      'Liberou visita sexta às 15h',
    ],
    owner: 'availability',
  }),
  [LeadFlowBusinessMode.EducationCourses]: pair({
    keys: ['class_capacity_full', 'class_seat_released'],
    labels: ['Turma sem vagas', 'Vaga na turma liberada'],
    resources: ['course', 'class', 'campus', 'seat'],
    examples: [
      'A turma da noite ficou sem vagas',
      'Liberou uma vaga na turma de sexta',
    ],
    owner: 'availability',
  }),
  [LeadFlowBusinessMode.Automotive]: pair({
    keys: ['automotive_capacity_full', 'automotive_slot_released'],
    labels: ['Veículo ou oficina indisponível', 'Veículo ou horário liberado'],
    resources: ['vehicle', 'workshop_bay', 'service', 'test_drive_slot'],
    examples: [
      'A oficina não tem mais vagas esta semana',
      'Liberou uma revisão sexta às 15h',
    ],
    owner: 'availability',
  }),
  [LeadFlowBusinessMode.RetailStore]: pair({
    keys: ['retail_stock_unavailable', 'retail_stock_released'],
    labels: ['Produto sem estoque', 'Produto disponível novamente'],
    resources: ['product', 'sku', 'variation', 'store'],
    examples: [
      'O tênis azul tamanho 40 acabou',
      'Chegaram duas unidades do tênis azul 40',
    ],
    owner: 'inventory',
  }),
  [LeadFlowBusinessMode.EcommerceLight]: pair({
    keys: ['ecommerce_stock_unavailable', 'ecommerce_stock_released'],
    labels: ['Produto indisponível', 'Estoque liberado'],
    resources: ['product', 'sku', 'variation', 'warehouse'],
    examples: ['O kit Premium acabou', 'Voltaram dez unidades do kit Premium'],
    owner: 'inventory',
  }),
  [LeadFlowBusinessMode.EventsTourism]: pair({
    keys: ['booking_capacity_full', 'booking_capacity_released'],
    labels: ['Reservas ou quartos esgotados', 'Quarto ou vaga liberada'],
    resources: ['hotel_room', 'room_type', 'package', 'tour', 'event_seat'],
    examples: [
      'Os quartos do fim de semana acabaram',
      'Liberou um quarto sexta às 15h',
    ],
    owner: 'availability',
  }),
  [LeadFlowBusinessMode.LegalAccounting]: pair({
    keys: ['professional_intake_full', 'consultation_slot_released'],
    labels: ['Triagem temporariamente lotada', 'Consulta liberada'],
    resources: ['practice_area', 'professional', 'consultation_slot'],
    examples: [
      'Não temos mais consultas tributárias esta semana',
      'Liberou uma consulta sexta às 15h',
    ],
    owner: 'agenda',
  }),
  [LeadFlowBusinessMode.FitnessWellness]: pair({
    keys: ['fitness_capacity_full', 'fitness_slot_released'],
    labels: ['Aula ou turma lotada', 'Vaga em aula liberada'],
    resources: ['class', 'instructor', 'assessment', 'seat'],
    examples: [
      'A aula de pilates de sexta lotou',
      'Liberou uma vaga sexta às 15h',
    ],
    owner: 'availability',
  }),
};

export function getOperationsChatCatalog(
  key: LeadFlowBusinessMode | string,
): LeadFlowJsonObject {
  const catalog: LeadFlowOperationsChatCatalog = {
    version: 1,
    readIntents: READ_INTENTS,
    writeIntents: WRITE_INTENTS,
    modeActions: MODE_ACTIONS[key as LeadFlowBusinessMode] ?? [],
  };
  return catalog as unknown as LeadFlowJsonObject;
}

function pair(input: {
  keys: [string, string];
  labels: [string, string];
  resources: string[];
  examples: [string, string];
  owner: LeadFlowOperationsChatAction['owningCapability'];
}): LeadFlowOperationsChatAction[] {
  const common = {
    resourceKinds: input.resources,
    requiredFields: ['resourceRef', 'effectivePeriod', 'timezone'],
    owningCapability: input.owner,
  };
  return [
    {
      ...common,
      key: input.keys[0],
      intent: 'capacity_unavailable',
      label: input.labels[0],
      examples: [input.examples[0]],
    },
    {
      ...common,
      key: input.keys[1],
      intent: 'capacity_released',
      label: input.labels[1],
      examples: [input.examples[1]],
    },
  ];
}
