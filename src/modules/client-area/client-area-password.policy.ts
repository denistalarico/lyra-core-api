import { BadRequestException } from '@nestjs/common';
import { CLIENT_AREA_ERROR_CODES } from './client-area.types';

/**
 * CA2 — password policy of Client Area identities (invitation signup and
 * reset). Stricter than the Agency DTO minimum (8) and aligned with Admin:
 * length is what matters for a human-chosen secret; no composition rules.
 */
export const CLIENT_AREA_PASSWORD_MIN_LENGTH = 10;
export const CLIENT_AREA_PASSWORD_MAX_LENGTH = 128;

export function assertClientAreaPasswordPolicy(input: {
  password: unknown;
  confirmation: unknown;
  email: string;
}): string {
  const password = typeof input.password === 'string' ? input.password : '';

  if (password !== input.confirmation) {
    throw policyError('Password confirmation does not match.');
  }

  if (
    password.trim().length < CLIENT_AREA_PASSWORD_MIN_LENGTH ||
    password.length > CLIENT_AREA_PASSWORD_MAX_LENGTH ||
    password.trim().toLowerCase() === input.email.trim().toLowerCase()
  ) {
    throw policyError(
      `Password must have ${CLIENT_AREA_PASSWORD_MIN_LENGTH} to ${CLIENT_AREA_PASSWORD_MAX_LENGTH} characters and differ from the email.`,
    );
  }

  return password;
}

function policyError(message: string) {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message,
    code: CLIENT_AREA_ERROR_CODES.passwordPolicy,
  });
}
