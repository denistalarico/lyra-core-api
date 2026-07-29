import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const APPOINTMENT_LIFECYCLE_STATUSES = [
  'pending',
  'confirmed',
  'rescheduled',
  'canceled',
  'no_show',
  'completed',
] as const;

export type AppointmentLifecycleStatus =
  (typeof APPOINTMENT_LIFECYCLE_STATUSES)[number];

export class PatchAppointmentLifecycleStatusDto {
  @IsIn(APPOINTMENT_LIFECYCLE_STATUSES)
  status!: AppointmentLifecycleStatus;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  confirmedVia?: string;
}
