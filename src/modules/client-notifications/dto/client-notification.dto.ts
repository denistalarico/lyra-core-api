import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ListClientNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Opaque `(createdAt, id)` cursor. Never parsed by the client. */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsIn(['all', 'unread'])
  status?: 'all' | 'unread';
}

export class ClientNotificationPushKeysDto {
  @IsString()
  p256dh!: string;

  @IsString()
  auth!: string;
}

/**
 * NTF-C1 §24 — note what is *not* here: a `surface` field. The boundary sets
 * it, so a request cannot register itself onto the Agency surface. The DTO
 * omitting it is the enforcement, not a convention.
 */
export class ClientNotificationPushSubscribeDto {
  @IsString()
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => ClientNotificationPushKeysDto)
  keys!: ClientNotificationPushKeysDto;
}

export class ClientNotificationPushUnsubscribeDto {
  @IsString()
  endpoint!: string;
}
