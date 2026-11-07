import { Equals, IsUUID } from 'class-validator';

export class SocialBoostPreflightDto {
  @IsUUID()
  publicationId!: string;

  @IsUUID()
  templateId!: string;

  @IsUUID()
  connectionId!: string;

  @IsUUID()
  requestId!: string;
}

export class ConfirmSocialBoostDto {
  @IsUUID()
  confirmationRequestId!: string;
}

/**
 * Planner: authorize a boost while scheduling. `spendAcknowledged` records
 * that the person saw the spend/billing notice; it is required, never inferred.
 */
export class ScheduleSocialBoostDto {
  @IsUUID()
  publicationId!: string;

  @IsUUID()
  templateId!: string;

  @IsUUID()
  connectionId!: string;

  @Equals(true)
  spendAcknowledged!: true;
}

export class UpdateScheduledSocialBoostDto {
  @IsUUID()
  templateId!: string;
}
