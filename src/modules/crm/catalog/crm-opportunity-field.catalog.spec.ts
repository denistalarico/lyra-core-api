import {
  businessModeFieldSpecs,
  coreFieldSpec,
  CRM_CORE_OPPORTUNITY_FIELDS,
  isAddressableOpportunityField,
} from './crm-opportunity-field.catalog';

describe('CRM opportunity field catalog', () => {
  describe('core fields', () => {
    it('gives every field an operator-facing name', () => {
      // The settings page used to ask an operator to type `contactPhone`.
      for (const spec of CRM_CORE_OPPORTUNITY_FIELDS) {
        expect(spec.label.trim()).not.toBe('');
        expect(spec.label).not.toBe(spec.key);
      }
    });

    it('marks identifiers as developer-only', () => {
      expect(coreFieldSpec('contactId')?.developerOnly).toBe(true);
      expect(coreFieldSpec('assignedUserId')?.developerOnly).toBe(true);
      expect(coreFieldSpec('contactPhone')?.developerOnly).toBe(false);
    });

    it('never claims a core field defines qualification on its own', () => {
      // Qualification is declared by the Business Mode, not by shared columns.
      for (const spec of CRM_CORE_OPPORTUNITY_FIELDS) {
        expect(spec.essential).toBe(false);
      }
    });

    it('has no duplicate keys', () => {
      const keys = CRM_CORE_OPPORTUNITY_FIELDS.map((spec) => spec.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('addressability', () => {
    it('accepts every catalogued core field', () => {
      for (const spec of CRM_CORE_OPPORTUNITY_FIELDS) {
        expect(isAddressableOpportunityField(spec.key)).toBe(true);
      }
    });

    it('accepts a well-formed business context key', () => {
      expect(
        isAddressableOpportunityField('businessContext.tipo_de_imovel'),
      ).toBe(true);
    });

    it('rejects an unknown column', () => {
      expect(isAddressableOpportunityField('passwordHash')).toBe(false);
      expect(isAddressableOpportunityField('metadata')).toBe(false);
    });

    it('rejects a business context key that could not be read back', () => {
      expect(isAddressableOpportunityField('businessContext.')).toBe(false);
      expect(isAddressableOpportunityField('businessContext.a.b')).toBe(false);
      expect(
        isAddressableOpportunityField(`businessContext.${'x'.repeat(81)}`),
      ).toBe(false);
    });
  });

  describe('business mode fields', () => {
    it('addresses a template field under businessContext', () => {
      const specs = businessModeFieldSpecs([
        {
          key: 'tipo_de_imovel',
          label: 'Tipo de imóvel',
          type: 'text',
          required: true,
        },
      ]);

      expect(specs).toEqual([
        expect.objectContaining({
          key: 'businessContext.tipo_de_imovel',
          label: 'Tipo de imóvel',
          origin: 'business_mode',
          essential: true,
        }),
      ]);
    });

    it('carries the required flag through as essential', () => {
      const specs = businessModeFieldSpecs([
        { key: 'a', label: 'Campo A', required: true },
        { key: 'b', label: 'Campo B', required: false },
      ]);

      expect(specs.map((spec) => spec.essential)).toEqual([true, false]);
    });

    it('drops entries that could never be read instead of repairing them', () => {
      // A silently fixed key would be selectable but always absent, which the
      // score would then read as "the lead did not answer".
      const specs = businessModeFieldSpecs([
        { key: 'ok', label: 'Válido' },
        { key: 'com espaco', label: 'Inválido' },
        { key: 'sem_label' },
        { label: 'Sem chave' },
      ]);

      expect(specs.map((spec) => spec.key)).toEqual(['businessContext.ok']);
    });

    it('does not repeat a key declared twice', () => {
      const specs = businessModeFieldSpecs([
        { key: 'orcamento', label: 'Orçamento' },
        { key: 'orcamento', label: 'Orçamento estimado' },
      ]);

      expect(specs).toHaveLength(1);
    });

    it('maps template types onto catalog types', () => {
      const specs = businessModeFieldSpecs([
        { key: 'a', label: 'A', type: 'textarea' },
        { key: 'b', label: 'B', type: 'number' },
        { key: 'c', label: 'C', type: 'select' },
        { key: 'd', label: 'D', type: 'algo_desconhecido' },
      ]);

      expect(specs.map((spec) => spec.type)).toEqual([
        'longText',
        'number',
        'enum',
        'text',
      ]);
    });
  });
});
