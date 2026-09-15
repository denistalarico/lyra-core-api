import { IsUUID } from 'class-validator';

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
