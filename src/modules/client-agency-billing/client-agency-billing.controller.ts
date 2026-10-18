import {
  Controller,
  Get,
  Header,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ClientAreaContextData,
  RequireClientAreaModule,
} from '../client-area/client-area.decorators';
import type { ClientAreaContext } from '../client-area/client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
} from '../client-area/guards/client-area.guards';
import { ClientAgencyBillingService } from './client-agency-billing.service';

@Controller('client-area/companies/:companyContextId/agency/billing')
@UseGuards(ClientAreaAuthGuard, ClientAreaMembershipGuard)
@RequireClientAreaModule('agency_billing')
export class ClientAgencyBillingController {
  constructor(private readonly billing: ClientAgencyBillingService) {}
  @Get('invoices') invoices(
    @ClientAreaContextData() context: ClientAreaContext,
  ) {
    return this.billing.invoices(context);
  }
  @Get('invoices/:invoiceId') invoice(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('invoiceId') id: string,
  ) {
    return this.billing.invoice(context, id);
  }
  @Get('invoices/:invoiceId/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async invoicePdf(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('invoiceId') id: string,
  ) {
    const file = await this.billing.invoicePdf(context, id);
    return new StreamableFile(file.buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
  @Get('contracts') contracts(
    @ClientAreaContextData() context: ClientAreaContext,
  ) {
    return this.billing.contractHistory(context);
  }
  @Get('contracts/:contractId/documents/:documentId/file')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async contractPdf(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('contractId') contractId: string,
    @Param('documentId') documentId: string,
  ) {
    const file = await this.billing.contractPdf(
      context,
      contractId,
      documentId,
    );
    return new StreamableFile(file.buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
}
