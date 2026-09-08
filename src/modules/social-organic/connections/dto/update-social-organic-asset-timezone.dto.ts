import { IsString, ValidateIf } from 'class-validator';

/**
 * Shape only: `timezone` is either a string or explicit `null` to clear it,
 * never `undefined` (an accidental omission must not read as "clear"). Whether
 * a string is a valid canonical IANA zone is checked by the same
 * `normalizeIanaTimeZone` guard A1.1 uses for provider-supplied values, not by
 * a second class-validator rule — see the service.
 */
export class UpdateSocialOrganicAssetTimezoneDto {
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  timezone!: string | null;
}
