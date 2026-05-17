import { IsBoolean } from 'class-validator';

export class PatchCrmStageFoldDto {
  @IsBoolean()
  isFolded!: boolean;
}
