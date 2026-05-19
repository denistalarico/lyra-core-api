import 'reflect-metadata';
import { AgencyDataSource } from '../database/agency-typeorm.datasource';
import {
  AgencySalesItemEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from '../modules/agency/entities/agency-sales.entities';

const TENANT_ID =
  process.env.SEED_AGENCY_TENANT_ID ??
  process.env.AGENCY_SEED_TENANT_ID ??
  '';

const WORKSPACE_ID =
  process.env.SEED_AGENCY_WORKSPACE_ID ??
  process.env.AGENCY_SEED_WORKSPACE_ID ??
  '';

type SalesItemSeed = {
  name: string;
  description: string;
  type: AgencySalesItemEntity['type'];
  category: string;
  billingType: AgencySalesItemEntity['billingType'];
  unitPriceCents?: number;
  setupPriceCents?: number;
  recurringPriceCents?: number;
  recurrenceInterval?: string;
};

const defaultStages = [
  {
    name: 'Novo',
    type: 'new',
    position: 10,
    probability: 10,
    isClosed: false,
    isWon: false,
  },
  {
    name: 'Qualificado',
    type: 'qualified',
    position: 20,
    probability: 30,
    isClosed: false,
    isWon: false,
  },
  {
    name: 'Proposta',
    type: 'proposal',
    position: 30,
    probability: 50,
    isClosed: false,
    isWon: false,
  },
  {
    name: 'Negociação',
    type: 'negotiation',
    position: 40,
    probability: 70,
    isClosed: false,
    isWon: false,
  },
  {
    name: 'Ganho',
    type: 'won',
    position: 50,
    probability: 100,
    isClosed: true,
    isWon: true,
  },
  {
    name: 'Perdido',
    type: 'lost',
    position: 60,
    probability: 0,
    isClosed: true,
    isWon: false,
  },
] as const;

const defaultItems: SalesItemSeed[] = [
  {
    name: 'Diagnóstico Estratégico',
    description:
      'Análise inicial para entender cenário, gargalos e oportunidades comerciais.',
    type: 'service',
    category: 'Consultoria',
    billingType: 'one_time',
    unitPriceCents: 49700,
  },
  {
    name: 'Landing Page',
    description:
      'Página profissional focada em conversão para campanhas, ofertas e captação.',
    type: 'service',
    category: 'Web',
    billingType: 'one_time',
    unitPriceCents: 120000,
  },
  {
    name: 'Site Institucional',
    description:
      'Site institucional de até 4 páginas para presença profissional e credibilidade.',
    type: 'service',
    category: 'Web',
    billingType: 'one_time',
    unitPriceCents: 240000,
  },
  {
    name: 'Gestão de Ads e Conversão',
    description:
      'Gestão recorrente de aquisição e conversão com estrutura comercial conectada.',
    type: 'plan',
    category: 'Marketing',
    billingType: 'setup_plus_recurring',
    setupPriceCents: 120000,
    recurringPriceCents: 120000,
    recurrenceInterval: 'monthly',
  },
  {
    name: 'Lyra LeadFlow',
    description:
      'Sistema de atendimento e qualificação de leads com automação comercial.',
    type: 'addon',
    category: 'Software',
    billingType: 'setup_plus_recurring',
    setupPriceCents: 150000,
    recurringPriceCents: 39700,
    recurrenceInterval: 'monthly',
  },
];

function assertSeedContext() {
  if (!TENANT_ID || !WORKSPACE_ID) {
    throw new Error(
      [
        'Missing seed context.',
        'Set SEED_AGENCY_TENANT_ID and SEED_AGENCY_WORKSPACE_ID before running this script.',
        'Example:',
        'SEED_AGENCY_TENANT_ID=... SEED_AGENCY_WORKSPACE_ID=... pnpm agency:seed-sales',
      ].join('\n'),
    );
  }
}

async function seed() {
  assertSeedContext();

  await AgencyDataSource.initialize();

  const pipelineRepo = AgencyDataSource.getRepository(AgencySalesPipelineEntity);
  const stageRepo = AgencyDataSource.getRepository(AgencySalesStageEntity);
  const itemRepo = AgencyDataSource.getRepository(AgencySalesItemEntity);

  let pipeline = await pipelineRepo.findOne({
    where: {
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Vendas',
    },
  });

  if (!pipeline) {
    pipeline = await pipelineRepo.save(
      pipelineRepo.create({
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        name: 'Vendas',
        status: 'active',
        isDefault: true,
        position: 10,
        metadata: {
          seed: 'agency-sales-default',
          source: 'lyra-agency',
        },
      }),
    );

    console.log(`Created pipeline: ${pipeline.name}`);
  } else {
    console.log(`Pipeline already exists: ${pipeline.name}`);
  }

  for (const stageSeed of defaultStages) {
    const existingStage = await stageRepo.findOne({
      where: {
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        pipelineId: pipeline.id,
        name: stageSeed.name,
      },
    });

    if (existingStage) {
      console.log(`Stage already exists: ${stageSeed.name}`);
      continue;
    }

    await stageRepo.save(
      stageRepo.create({
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        pipelineId: pipeline.id,
        name: stageSeed.name,
        type: stageSeed.type,
        position: stageSeed.position,
        probability: stageSeed.probability,
        isClosed: stageSeed.isClosed,
        isWon: stageSeed.isWon,
        metadata: {
          seed: 'agency-sales-default',
          source: 'lyra-agency',
        },
      }),
    );

    console.log(`Created stage: ${stageSeed.name}`);
  }

  for (const itemSeed of defaultItems) {
    const existingItem = await itemRepo.findOne({
      where: {
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        name: itemSeed.name,
      },
    });

    if (existingItem) {
      console.log(`Item already exists: ${itemSeed.name}`);
      continue;
    }

    await itemRepo.save(
      itemRepo.create({
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        name: itemSeed.name,
        description: itemSeed.description,
        type: itemSeed.type,
        category: itemSeed.category,
        billingType: itemSeed.billingType,
        currency: 'BRL',
        unitPriceCents: itemSeed.unitPriceCents ?? 0,
        setupPriceCents: itemSeed.setupPriceCents ?? 0,
        recurringPriceCents: itemSeed.recurringPriceCents ?? 0,
        recurrenceInterval: itemSeed.recurrenceInterval ?? null,
        status: 'active',
        metadata: {
          seed: 'agency-sales-default',
          source: 'lyra-agency',
        },
      }),
    );

    console.log(`Created item: ${itemSeed.name}`);
  }

  await AgencyDataSource.destroy();

  console.log('Agency Sales seed executed successfully.');
}

seed().catch(async (error) => {
  console.error('Agency Sales seed error:', error);

  if (AgencyDataSource.isInitialized) {
    await AgencyDataSource.destroy();
  }

  process.exit(1);
});
