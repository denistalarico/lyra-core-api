import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Input of `POST /orion/turns`. Scope (tenant, workspace, client, company,
 * user) never comes from here: it is the caller's JWT and guards.
 */
export class CreateOrionTurnDto {
  /** Free text the deterministic interpreter did not understand (D-OR-6). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;

  /** HTTP turns come from the Operations Room; the chats call the service. */
  @IsOptional()
  @IsIn(['operations_room'])
  surface?: 'operations_room';

  /** The agent selected in the room; ignored unless the caller can see it. */
  @IsOptional()
  @IsUUID()
  agentId?: string;

  /** Client-generated key: a double submit never pays twice. */
  @IsOptional()
  @IsUUID()
  clientTurnId?: string;
}
