import type { ConfigService } from '@nestjs/config';
import { ClientAreaManagementService } from './services/client-area-management.service';

/**
 * PD1 §L — coverage for the branding resolver's agency/custom fallback.
 *
 * The reported symptom was "I changed the appearance options and saw no
 * effect". The resolver was correct and the API persisted every field; the
 * Agency form simply had no inputs for `displayName`, `logoLightUrl`,
 * `logoDarkUrl`, `primaryColor` or `secondaryColor`, so choosing
 * "Personalizar" set `brandingMode = 'custom'` while leaving all of them NULL.
 * In custom mode the colours are returned as-is, so NULL colours replaced the
 * agency ones and the Client Area appeared unbranded.
 *
 * These tests pin the two halves of that contract, so a future change cannot
 * silently make custom mode ignore stored values or leak NULLs where the
 * agency identity should be inherited.
 */
describe('PD1 ClientAreaManagementService branding', () => {
  const TENANT = 'tenant-1';
  const WORKSPACE = 'workspace-1';

  const AGENCY_IDENTITY = {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    tradeName: 'Talarico Labs',
    logoUrl: '/api/assets/agency/logo-light.webp',
    logoDarkUrl: '/api/assets/agency/logo-dark.webp',
    avatarUrl: '/api/assets/agency/avatar.webp',
    primaryColor: '#2563EB',
    secondaryColor: '#1E293B',
  };

  function buildService(settings: Record<string, unknown> | null) {
    const config = {
      get: (key: string) =>
        key === 'CLIENT_AREA_ENABLED' ? 'true' : undefined,
    } as unknown as ConfigService;

    const repo = (findOne: unknown) => ({
      findOne: jest.fn().mockResolvedValue(findOne),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      create: jest.fn((value: unknown) => value),
    });

    return new ClientAreaManagementService(
      config,
      repo(settings) as never,
      repo(null) as never,
      repo(null) as never,
      repo(AGENCY_IDENTITY) as never,
      repo(null) as never,
      repo(null) as never,
      repo(null) as never,
      repo(null) as never,
      repo(null) as never,
      repo(null) as never,
      repo(null) as never,
      repo(null) as never,
      { isMembershipEligible: jest.fn().mockResolvedValue(true) } as never,
    );
  }

  const customSettings = (overrides: Record<string, unknown> = {}) => ({
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    enabled: true,
    brandingMode: 'custom',
    loginLayout: 'centered',
    ...overrides,
  });

  it('inherits the agency identity in agency mode, ignoring stored custom values', async () => {
    // Custom values present but mode is 'agency': they must not leak through.
    const service = buildService({
      ...customSettings({
        brandingMode: 'agency',
        displayName: 'Nome Personalizado',
        primaryColor: '#FF0000',
      }),
    });

    const branding = await service.branding(TENANT, WORKSPACE);

    expect(branding.displayName).toBe('Talarico Labs');
    expect(branding.primaryColor).toBe('#2563EB');
    expect(branding.logoLightUrl).toBe('/api/assets/agency/logo-light.webp');
  });

  it('returns the stored custom values in custom mode', async () => {
    const service = buildService(
      customSettings({
        displayName: 'Área do Cliente Talarico',
        logoLightUrl: '/api/assets/custom-light.webp',
        primaryColor: '#7C3AED',
        secondaryColor: '#111827',
      }),
    );

    const branding = await service.branding(TENANT, WORKSPACE);

    expect(branding.displayName).toBe('Área do Cliente Talarico');
    expect(branding.logoLightUrl).toBe('/api/assets/custom-light.webp');
    expect(branding.primaryColor).toBe('#7C3AED');
    expect(branding.secondaryColor).toBe('#111827');
  });

  it('falls back to the agency name and logo when custom mode leaves them unset', async () => {
    // Exactly the state the form used to produce: custom mode, nothing filled.
    const service = buildService(customSettings());

    const branding = await service.branding(TENANT, WORKSPACE);

    expect(branding.displayName).toBe('Talarico Labs');
    expect(branding.logoLightUrl).toBe('/api/assets/agency/logo-light.webp');
  });

  it('defaults to the agency identity when no settings row exists yet', async () => {
    const service = buildService(null);

    const branding = await service.branding(TENANT, WORKSPACE);

    expect(branding.displayName).toBe('Talarico Labs');
    expect(branding.primaryColor).toBe('#2563EB');
  });
});
