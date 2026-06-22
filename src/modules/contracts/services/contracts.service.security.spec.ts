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
  function createService() {
    return new ContractsService(
      {} as Repository<ContractTemplate>,
      {} as Repository<ContractTemplateVersion>,
      {} as Repository<ContractSignatureProviderSetting>,
      {} as Repository<ContractRecord>,
      {} as Repository<ContractParty>,
      {} as Repository<ContractDocument>,
      {} as Repository<ContractEvent>,
      {} as unknown as ContractNotificationPublisher,
    );
  }

  it('drops scripts from header/body/footer while keeping safe markup', () => {
    const service = createService();

    const malicious = '<script>window.__xss = true</script><p>Ok</p>';

    const result = service.previewTemplate(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      } as any,
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

  it('renders the first populated variable from an alias token', () => {
    const service = createService();

    const result = service.previewTemplate(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      } as any,
      {
        bodyHtml: '<p>{{agency.legalName / company.legalName}}</p>',
        variablesData: { 'company.legalName': 'Empresa Exemplo Ltda.' },
      } as any,
    );

    expect(result.html).toContain('<p>Empresa Exemplo Ltda.</p>');
    expect(result.html).not.toContain('{{agency.legalName');
  });

  it('renders variables auto-linked by the rich-text editor', () => {
    const service = createService();

    const result = service.previewTemplate(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      } as any,
      {
        bodyHtml: '<p>{{<a href="http://member.email">member.email</a>}}</p>',
        variablesData: { 'member.email': 'membro@example.com' },
      } as any,
    );

    expect(result.html).toContain('<p>membro@example.com</p>');
    expect(result.html).not.toContain('http://member.email');
  });
});
