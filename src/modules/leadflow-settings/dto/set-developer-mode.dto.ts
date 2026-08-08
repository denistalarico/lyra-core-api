import { IsBoolean } from 'class-validator';

/**
 * Developer Mode reopens every advanced field of the agent context in the UI.
 * It is deliberately its own endpoint rather than a key on the general PATCH:
 * the general update is an administrator action, while unlocking the raw
 * configuration is owner-only.
 */
export class SetLeadFlowDeveloperModeDto {
  @IsBoolean()
  enabled!: boolean;
}
