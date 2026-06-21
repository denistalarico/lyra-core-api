import { Repository } from 'typeorm';
import {
  ContractDocument,
  ContractEvent,
  ContractParty,
  ContractRecord,
  ContractSignatureProviderSetting,
  ContractTemplate,
  ContractTemplateVersion,
} from '../entities';
import { ContractNotificationPublisher } from './contract-notification.publisher';
import { ContractsService } from './contracts.service';

describe('ContractsService.previewTemplate sanitization', () => {
  it('drops scripts from header/body/footer while keeping safe markup', () => {
    const service = new ContractsService(
      {} as Repository<ContractTemplate>,
      {} as Repository<ContractTemplateVersion>,
      {} as Repository<ContractSignatureProviderSetting>,
      {} as Repository<ContractRecord>,
      {} as Repository<ContractParty>,
      {} as Repository<ContractDocument>,
      {} as Repository<ContractEvent>,
      {} as unknown as ContractNotificationPublisher,
    );

    const malicious = '<script>window.__xss = true</script><p>Ok</p>';

    const result = service.previewTemplate(
      { tenantId: 'tenant-1', workspaceId: 'workspace-1', userId: 'user-1' } as any,
      {
        title: 'Modelo malicioso',
        headerHtml: malicious,
        bodyHtml: malicious,
        footerHtml: malicious,
        variablesData: {},
      } as any,
    );

    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('__xss');
    expect(result.html).toContain('<p>Ok</p>');
  });
});
