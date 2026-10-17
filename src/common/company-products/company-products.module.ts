import { Module } from '@nestjs/common';
import { CompanyProductRegistry } from './company-product.registry';

@Module({
  providers: [CompanyProductRegistry],
  exports: [CompanyProductRegistry],
})
export class CompanyProductsModule {}
