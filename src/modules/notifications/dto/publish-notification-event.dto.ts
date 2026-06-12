import {
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../enums';

export class NotificationEventRecipientDto {
  @IsUUID()
  userId!: string;

  @IsEnum(NotificationInterestReason)
  interestReason!: NotificationInterestReason;
}

export class PublishNotificationEventDto {
  @IsString()
  @MaxLength(160)
  eventId!: string;

  @IsString()
  @MaxLength(120)
  eventType!: string;

  @IsEnum(NotificationProductKey)
  productKey!: NotificationProductKey;

  @IsString()
  @MaxLength(80)
  moduleKey!: string;

  @IsEnum(NotificationActorType)
  actorType!: NotificationActorType;

  @IsOptional()
  @IsUUID()
  actorUserId?: string | null;

  @IsOptional()
  @IsUUID()
  initiatedByUserId?: string | null;

  @IsOptional()
  @IsUUID()
  managedTenantId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  resourceType?: string | null;

  @IsOptional()
  @IsUUID()
  resourceId?: string | null;

  @IsDateString()
  occurredAt!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationEventRecipientDto)
  recipients!: NotificationEventRecipientDto[];

  @IsObject()
  payload!: Record<string, unknown>;
}
