import {
  buildHandoffTemplateParameters,
  isPlatformWhatsAppTemplateKeyAllowed,
  LEADFLOW_HANDOFF_TEMPLATE_KEY,
  resolvePlatformWhatsAppTemplate,
} from './platform-whatsapp-notification.catalog';

describe('platform whatsapp template catalog', () => {
  describe('resolvePlatformWhatsAppTemplate', () => {
    it('resolves the logical handoff key to the approved physical template', () => {
      const template = resolvePlatformWhatsAppTemplate(
        LEADFLOW_HANDOFF_TEMPLATE_KEY,
      );
      expect(template).toMatchObject({
        providerTemplateName: 'lyra_leadflow_handoff_alert_v1',
        languageCode: 'pt_BR',
        category: 'utility',
        status: 'approved',
      });
    });

    it('falls back to the generic template when a Business Mode has none', () => {
      const template = resolvePlatformWhatsAppTemplate(
        LEADFLOW_HANDOFF_TEMPLATE_KEY,
        'clinic',
      );
      expect(template?.providerTemplateName).toBe(
        'lyra_leadflow_handoff_alert_v1',
      );
      expect(template?.businessModeKey).toBeNull();
    });

    it('returns null for an unknown key (caller maps to skipped_template_unavailable)', () => {
      expect(resolvePlatformWhatsAppTemplate('leadflow.unknown')).toBeNull();
    });
  });

  describe('isPlatformWhatsAppTemplateKeyAllowed', () => {
    it('allows only a key that resolves to an approved template', () => {
      expect(
        isPlatformWhatsAppTemplateKeyAllowed(LEADFLOW_HANDOFF_TEMPLATE_KEY),
      ).toBe(true);
      expect(isPlatformWhatsAppTemplateKeyAllowed('leadflow.invented')).toBe(
        false,
      );
    });
  });

  describe('buildHandoffTemplateParameters', () => {
    it('emits exactly three parameters in the approved order', () => {
      const params = buildHandoffTemplateParameters({
        workspaceName: 'Acme',
        contactDisplayName: 'João',
        handoffReason: 'Pediu atendimento humano',
      });
      expect(params).toEqual(['Acme', 'João', 'Pediu atendimento humano']);
    });

    it('collapses newlines/tabs and control chars into single spaces', () => {
      const [workspace] = buildHandoffTemplateParameters({
        workspaceName: 'Acme\n\tLtda\r\n  Filial',
        contactDisplayName: 'x',
        handoffReason: 'y',
      });
      expect(workspace).toBe('Acme Ltda Filial');
      expect(workspace).not.toMatch(/[\n\r\t]/);
    });

    it('applies terminal fallbacks when a variable is empty after normalization', () => {
      const params = buildHandoffTemplateParameters({
        workspaceName: '   ',
        contactDisplayName: '',
        handoffReason: '\n\n',
      });
      expect(params).toEqual([
        'Sua empresa',
        'Contato sem nome',
        'Solicitação de atendimento humano',
      ]);
    });

    it('caps very long values', () => {
      const [, , reason] = buildHandoffTemplateParameters({
        workspaceName: 'a',
        contactDisplayName: 'b',
        handoffReason: 'x'.repeat(500),
      });
      expect(reason.length).toBeLessThanOrEqual(160);
    });
  });
});
