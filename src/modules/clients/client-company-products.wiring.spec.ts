import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { CompanyProductsModule } from '../../common/company-products/company-products.module';
import { CompanyProductRegistry } from '../../common/company-products/company-product.registry';
import { SocialPublicationCompanyProductParticipant } from '../social-organic/publication/social-publication-company-product.participant';
import { SocialPublicationService } from '../social-organic/publication/social-publication.service';
import { SocialApprovalsCompanyProductParticipant } from '../social-approvals/social-approvals-company-product.participant';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import { LeadFlowCompanyProductParticipant } from '../leadflow-settings/leadflow-company-product.participant';
import { LeadFlowClientSettingsService } from '../leadflow-settings/services/leadflow-client-settings.service';
import { LeadFlowAgentsCompanyProductParticipant } from '../leadflow-agents/leadflow-agents-company-product.participant';
import { LeadFlowAutomationsCompanyProductParticipant } from '../leadflow-automations/leadflow-automations-company-product.participant';
import { LeadFlowAgendaCompanyProductParticipant } from '../leadflow-agenda/leadflow-agenda-company-product.participant';
import { LeadFlowSettingsModule } from '../leadflow-settings/leadflow-settings.module';
import { LeadFlowAgentsModule } from '../leadflow-agents/leadflow-agents.module';
import { LeadFlowAutomationsModule } from '../leadflow-automations/leadflow-automations.module';
import { LeadFlowAgendaModule } from '../leadflow-agenda/leadflow-agenda.module';
import { SocialApprovalsModule } from '../social-approvals/social-approvals.module';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { ClientsModule } from './clients.module';
import { RemoveCompanyProductDto } from './dto/company-product.dto';

jest.mock('otplib', () => ({ verify: jest.fn() }));
const wiring = [
  [LeadFlowSettingsModule, LeadFlowCompanyProductParticipant],
  [LeadFlowAgentsModule, LeadFlowAgentsCompanyProductParticipant],
  [LeadFlowAutomationsModule, LeadFlowAutomationsCompanyProductParticipant],
  [LeadFlowAgendaModule, LeadFlowAgendaCompanyProductParticipant],
  [SocialApprovalsModule, SocialApprovalsCompanyProductParticipant],
  [SocialOrganicModule, SocialPublicationCompanyProductParticipant],
] as const;
describe('CA6 registry wiring', () => {
  it('owning domain modules provide their adapter and import the shared registry module', () => {
    for (const [module, participant] of wiring) {
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, module)).toContain(
        CompanyProductsModule,
      );
      expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module)).toContain(
        participant,
      );
    }
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, ClientsModule),
    ).toContain(CompanyProductsModule);
  });
  it('Nest onModuleInit fills the same registry consumed by the coordinator', async () => {
    const ref = await Test.createTestingModule({
      imports: [CompanyProductsModule],
      providers: [
        ...wiring.map(([, p]) => p),
        { provide: LeadFlowClientSettingsService, useValue: {} },
        { provide: SocialPublicationService, useValue: {} },
        { provide: SocialApprovalsService, useValue: {} },
      ],
    }).compile();
    try {
      const registry = ref.get(CompanyProductRegistry);
      expect(() => registry.forProduct('social')).toThrow('unavailable');
      await ref.init();
      expect(
        registry
          .forProduct('social')
          .map((p) => p.key)
          .sort(),
      ).toEqual(['social-approvals', 'social-publications']);
      expect(
        registry
          .forProduct('leadflow')
          .map((p) => p.key)
          .sort(),
      ).toEqual([
        'leadflow-agenda',
        'leadflow-agents',
        'leadflow-automations',
        'leadflow-settings',
      ]);
    } finally {
      await ref.close();
    }
  });
  it('requires confirmation and a supported removal mode at the HTTP boundary', async () => {
    expect(
      await validate(
        Object.assign(new RemoveCompanyProductDto(), {
          mode: 'immediate',
          confirm: true,
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new RemoveCompanyProductDto(), {
          mode: 'immediate',
          confirm: false,
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        Object.assign(new RemoveCompanyProductDto(), {
          mode: 'later',
          confirm: true,
        }),
      ),
    ).not.toHaveLength(0);
  });
});
