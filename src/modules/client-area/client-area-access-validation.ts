import { BadRequestException } from '@nestjs/common';
import {
  CLIENT_AREA_ACCESS_LEVELS,
  CLIENT_AREA_MODULE_KEYS,
  type ClientAreaModuleLevels,
  type ClientAreaModuleSettings,
  type ClientAreaRole,
} from './client-area.types';
export function validateModuleLevels(value: unknown): ClientAreaModuleLevels {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('moduleLevels must be an object.');
  for (const [key, level] of Object.entries(value as Record<string, unknown>))
    if (
      !(CLIENT_AREA_MODULE_KEYS as readonly string[]).includes(key) ||
      !(CLIENT_AREA_ACCESS_LEVELS as readonly unknown[]).includes(level)
    )
      throw new BadRequestException(
        'Invalid module or access level. Omit a module to remove access.',
      );
  return value as ClientAreaModuleLevels;
}
export function validateModuleSettings(
  value: unknown,
): ClientAreaModuleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('moduleSettings must be an object.');
  for (const [key, state] of Object.entries(value as Record<string, unknown>)) {
    if (
      !(CLIENT_AREA_MODULE_KEYS as readonly string[]).includes(key) ||
      !state ||
      typeof state !== 'object' ||
      Array.isArray(state) ||
      Object.keys(state).some((k) => !['enabled', 'defaultLevel'].includes(k))
    )
      throw new BadRequestException('Invalid module settings.');
    const setting = state as { enabled: unknown; defaultLevel: unknown };
    if (
      typeof setting.enabled !== 'boolean' ||
      (setting.defaultLevel !== null &&
        !(CLIENT_AREA_ACCESS_LEVELS as readonly unknown[]).includes(
          setting.defaultLevel,
        ))
    )
      throw new BadRequestException('Invalid module settings.');
  }
  return value as ClientAreaModuleSettings;
}
export function legacyDefaultLevel(role: ClientAreaRole) {
  return role === 'client_admin' || role === 'client_owner'
    ? 'manager'
    : role === 'client_operator'
      ? 'operator'
      : 'viewer';
}
