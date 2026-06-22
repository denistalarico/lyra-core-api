import { getPermissionDefinition } from './permission-keys.catalog';
import { PlatformRoleKey } from '../enums/permission.enums';

/**
 * Functional permission groups used by the Settings > Users admin UI
 * (Sprint 13). Each group maps to a curated subset of permission keys from
 * the main catalog, grouped by business area instead of exposing the full
 * permission matrix.
 *
 * Owner-only permission keys are intentionally excluded from every group:
 * they must never be granted as part of a "common" functional group.
 */
export interface PermissionGroupDefinition {
  key: string;
  label: string;
  description: string;
  permissionKeys: string[];
}

export function isOwnerOnlyPermissionKey(key: string): boolean {
  const definition = getPermissionDefinition(key);

  if (!definition) {
    return false;
  }

  return (
    definition.roles.length === 1 && definition.roles[0] === PlatformRoleKey.Owner
  );
}

interface RawPermissionGroup {
  key: string;
  label: string;
  description: string;
  permissionKeys: string[];
}

const RAW_PERMISSION_GROUPS: RawPermissionGroup[] = [
  {
    key: 'hr_team',
    label: 'RH / Equipe',
    description:
      'Gestão de membros do time, estrutura, ponto/presença e convites de usuários.',
    permissionKeys: [
      'agency.team.directory.view.all_members',
      'agency.team.member.view.self',
      'agency.team.member.update.self',
      'agency.team.member.view.department',
      'agency.team.member.update.department',
      'agency.team.structure.manage.admin',
      'agency.team.attendance.view.self',
      'agency.team.attendance.view.department',
      'agency.team.attendance.approve.department',
      'agency.team.users.invite.admin',
      'agency.team.users.deactivate.admin',
    ],
  },
  {
    key: 'finance',
    label: 'Financeiro / Contador',
    description:
      'Visualização e gestão de lançamentos, relatórios e configurações financeiras.',
    permissionKeys: [
      'agency.finance.summary.view.finance_or_owner',
      'agency.finance.transactions.view.finance_or_owner',
      'agency.finance.reports.view.finance_or_owner',
      'agency.finance.settings.manage.admin_or_owner',
    ],
  },
  {
    key: 'contracts',
    label: 'Contratos',
    description:
      'Criação, envio para assinatura, arquivamento e gestão de modelos de contrato.',
    permissionKeys: [
      'agency.contracts.view.assigned',
      'agency.contracts.create.from_template',
      'agency.contracts.send_signature.manager_or_admin',
      'agency.contracts.templates.manage.admin',
      'agency.contracts.archive.admin',
    ],
  },
  {
    key: 'clients',
    label: 'Clientes',
    description:
      'Visualização e gestão de perfis de clientes, produtos contratados e managed tenants.',
    permissionKeys: [
      'agency.clients.profile.view.basic.assigned',
      'agency.clients.profile.view.relationship.assigned',
      'agency.clients.profile.view.business.admin',
      'agency.clients.profile.create.admin',
      'agency.clients.profile.update.assigned',
      'agency.clients.profile.archive.admin',
      'agency.clients.products.view.assigned',
      'agency.clients.products.manage.admin',
      'agency.clients.managed_tenant.view.admin',
      'agency.clients.lifecycle.view.assigned',
      'agency.clients.lifecycle.manage.assigned',
      'agency.clients.lifecycle.settings.manage.admin',
    ],
  },
  {
    key: 'sales',
    label: 'Comercial',
    description:
      'CRM, pipeline de vendas, propostas/orçamentos e planos comerciais.',
    permissionKeys: [
      'agency.sales.contacts.create',
      'agency.sales.contacts.update.assigned',
      'agency.sales.crm.view.assigned',
      'agency.sales.crm.view.department',
      'agency.sales.crm.manage.department',
      'agency.sales.pipeline.manage.admin',
      'agency.sales.stages.manage.manager_or_admin',
      'agency.sales.quotes.create',
      'agency.sales.quotes.approve.department',
      'agency.sales.products.manage.admin',
      'agency.sales.plans.manage.admin',
    ],
  },
  {
    key: 'knowledge',
    label: 'Conhecimento',
    description:
      'Artigos, comentários, mural e categorias da base de conhecimento.',
    permissionKeys: [
      'agency.knowledge.articles.view.published',
      'agency.knowledge.articles.comment',
      'agency.knowledge.wall.post',
      'agency.knowledge.articles.create.department',
      'agency.knowledge.articles.publish.department',
      'agency.knowledge.categories.manage.admin',
    ],
  },
  {
    key: 'dashboards',
    label: 'Dashboards',
    description: 'Visualização de dashboards próprios, do time e da agência.',
    permissionKeys: [
      'agency.dashboards.view.self',
      'agency.dashboards.view.department',
      'agency.dashboards.view.agency',
    ],
  },
];

export const PERMISSION_FUNCTIONAL_GROUPS: PermissionGroupDefinition[] =
  RAW_PERMISSION_GROUPS.map((group) => ({
    ...group,
    permissionKeys: group.permissionKeys.filter(
      (key) => !isOwnerOnlyPermissionKey(key),
    ),
  }));

export function getPermissionFunctionalGroups(): PermissionGroupDefinition[] {
  return PERMISSION_FUNCTIONAL_GROUPS;
}
