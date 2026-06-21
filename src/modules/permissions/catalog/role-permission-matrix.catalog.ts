import { PLATFORM_ROLE_KEYS, PlatformRoleKey } from '../enums/permission.enums';
import { PERMISSION_DEFINITIONS } from './permission-keys.catalog';

/**
 * Default Owner/Admin/Manager/Member permission matrix derived from the
 * permission catalog. Owner always receives every permission key
 * regardless of the catalog entry (blueprint section 7.1).
 */
export const DEFAULT_ROLE_PERMISSION_MATRIX: Record<PlatformRoleKey, string[]> =
  PLATFORM_ROLE_KEYS.reduce(
    (matrix, roleKey) => {
      matrix[roleKey] = PERMISSION_DEFINITIONS.filter((definition) =>
        roleKey === PlatformRoleKey.Owner ? true : definition.roles.includes(roleKey),
      ).map((definition) => definition.key);

      return matrix;
    },
    {} as Record<PlatformRoleKey, string[]>,
  );

export const DEFAULT_ROLE_DESCRIPTIONS: Record<PlatformRoleKey, string> = {
  [PlatformRoleKey.Owner]:
    'Dono da conta. Acesso total, incluindo billing, fiscal, transferência de ownership e ações destrutivas.',
  [PlatformRoleKey.Admin]:
    'Administrador operacional. Opera a agência sem controlar billing, fiscal ou apagar a conta.',
  [PlatformRoleKey.Manager]:
    'Gestor de área, departamento, carteira, cliente ou produto. Sempre limitado por escopo.',
  [PlatformRoleKey.Member]:
    'Executor operacional. Acesso limitado a itens próprios ou atribuídos.',
};
