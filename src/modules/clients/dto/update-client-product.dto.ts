import { IsIn } from 'class-validator';

export const CLIENT_PRODUCT_ACTIONS = ['activate', 'suspend'] as const;
export type ClientProductAction = (typeof CLIENT_PRODUCT_ACTIONS)[number];

export class UpdateClientProductDto {
  @IsIn(CLIENT_PRODUCT_ACTIONS)
  action!: ClientProductAction;
}
