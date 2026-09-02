// Lyra Social S1.4.8 §13 — product-bound authorization for the neutral
// telemetry routes. Same rule S1.4.0 and the S1.4.7 pointed correction
// established: the key is chosen by the request's own productKey, and the
// other product's key never authorizes.

import { ForbiddenException } from '@nestjs/common';
import { resolveTelemetryPermissionKey } from './platform-privacy-permission.helper';

describe('resolveTelemetryPermissionKey', () => {
  it('7: viewing under a Social context requires the Social view key', () => {
    expect(resolveTelemetryPermissionKey('social', 'view')).toBe(
      'social.settings.telemetry.view.admin',
    );
  });

  it('8: managing under a Social context requires the Social owner-only key', () => {
    expect(resolveTelemetryPermissionKey('social', 'manage')).toBe(
      'social.settings.telemetry.manage.owner_only',
    );
  });

  it('binds the LeadFlow keys under a LeadFlow context', () => {
    expect(resolveTelemetryPermissionKey('leadflow', 'view')).toBe(
      'leadflow.settings.telemetry.view.admin',
    );
    expect(resolveTelemetryPermissionKey('leadflow', 'manage')).toBe(
      'leadflow.settings.telemetry.manage.owner_only',
    );
  });

  it('9: a Social context never resolves to a LeadFlow key, and vice versa', () => {
    expect(resolveTelemetryPermissionKey('social', 'manage')).not.toContain(
      'leadflow',
    );
    expect(resolveTelemetryPermissionKey('leadflow', 'manage')).not.toContain(
      'social',
    );
  });

  it('rejects a context with no product asking — no fallback key', () => {
    expect(() => resolveTelemetryPermissionKey('agency', 'view')).toThrow(
      ForbiddenException,
    );
    expect(() => resolveTelemetryPermissionKey(undefined, 'manage')).toThrow(
      ForbiddenException,
    );
  });

  it('keeps view and manage distinct (view never grants mutation)', () => {
    expect(resolveTelemetryPermissionKey('social', 'view')).not.toBe(
      resolveTelemetryPermissionKey('social', 'manage'),
    );
    expect(resolveTelemetryPermissionKey('social', 'manage')).toContain(
      'owner_only',
    );
  });
});
