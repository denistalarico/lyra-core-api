import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClientCompanyProductsService } from './client-company-products.service';

@Injectable()
export class ClientCompanyProductsScheduler {
  constructor(private readonly products: ClientCompanyProductsService) {}
  @Cron('*/30 * * * * *', { waitForCompletion: true })
  async tick() {
    await this.products.reconcilePending();
  }
}
