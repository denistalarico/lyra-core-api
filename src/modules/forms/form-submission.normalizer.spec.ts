import {
  FormValidationError,
  isValidCnpj,
  isValidCpf,
  normalizePhone,
  normalizeSubmission,
  phoneMatchVariants,
  sanitizeAttribution,
} from './form-submission.normalizer';
import type { FormField } from './forms.types';

const FIELDS: FormField[] = [
  {
    key: 'nome',
    label: 'Nome',
    type: 'text',
    required: true,
    target: 'contact.name',
  },
  { key: 'email', label: 'E-mail', type: 'email', target: 'contact.email' },
  { key: 'fone', label: 'WhatsApp', type: 'phone', target: 'contact.phone' },
  {
    key: 'orcamento',
    label: 'Orçamento',
    type: 'text',
    target: 'opportunity.value',
  },
  {
    key: 'servicos',
    label: 'Serviços',
    type: 'checkbox',
    options: ['Site', 'Tráfego'],
    target: 'none',
  },
  {
    key: 'msg',
    label: 'Mensagem',
    type: 'textarea',
    target: 'opportunity.notes',
  },
  {
    key: 'lgpd',
    label: 'Aceito',
    type: 'consent',
    required: true,
    target: 'none',
  },
  { key: 'origem', label: 'Origem', type: 'hidden', target: 'none' },
];

describe('form-submission.normalizer', () => {
  it('maps values to lead/opportunity and builds the summary', () => {
    const result = normalizeSubmission(FIELDS, {
      nome: '  Maria Silva ',
      email: 'Maria@Example.COM',
      fone: '(11) 98765-4321',
      orcamento: 'R$ 1.500,50',
      servicos: ['Site', 'Site'],
      msg: 'Quero um site',
      lgpd: 'on',
      origem: 'lp-black-friday',
    });
    expect(result.lead).toEqual({
      name: 'Maria Silva',
      email: 'maria@example.com',
      phone: '+5511987654321',
      company: null,
      position: null,
    });
    expect(result.opportunity).toEqual({
      title: null,
      valueAmount: 1500.5,
      notes: 'Quero um site',
    });
    expect(result.values.servicos).toEqual(['Site']);
    expect(result.values.origem).toBe('lp-black-friday');
    // hidden and consent stay out of the human summary
    expect(result.summaryLines).toEqual([
      'Nome: Maria Silva',
      'E-mail: maria@example.com',
      'WhatsApp: +5511987654321',
      'Orçamento: R$ 1.500,50',
      'Serviços: Site',
      'Mensagem: Quero um site',
    ]);
  });

  it('collects every field error at once', () => {
    try {
      normalizeSubmission(FIELDS, {
        email: 'nao-e-email',
        fone: '12',
        servicos: ['Outro'],
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(FormValidationError);
      expect(
        Object.keys((error as FormValidationError).fieldErrors).sort(),
      ).toEqual(['email', 'fone', 'lgpd', 'nome', 'servicos'].sort());
    }
  });

  it('ignores keys the form does not declare', () => {
    const result = normalizeSubmission(FIELDS.slice(0, 1), {
      nome: 'Ana',
      senha: '123',
    });
    expect(result.values).toEqual({ nome: 'Ana' });
  });

  it.each([
    ['(11) 98765-4321', '+5511987654321'],
    ['011 98765 4321', '+5511987654321'],
    ['+351 912 345 678', '+351912345678'],
    ['0055 11 3333-4444', '+551133334444'],
    ['123', null],
  ])('normalizePhone(%s) = %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('phoneMatchVariants covers numbers stored without the country code', () => {
    expect(phoneMatchVariants('+5511987654321')).toEqual([
      '5511987654321',
      '11987654321',
    ]);
    expect(phoneMatchVariants('+351912345678')).toEqual(['351912345678']);
  });

  it('validates CPF and CNPJ check digits', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
  });

  it('sanitizeAttribution keeps whitelisted keys and http(s) URLs only', () => {
    expect(
      sanitizeAttribution({
        utm_source: 'meta',
        gclid: 'abc',
        evil: 'x',
        pageUrl: 'https://site.com/lp?utm_source=meta',
        referrer: 'javascript:alert(1)',
      }),
    ).toEqual({
      utm_source: 'meta',
      gclid: 'abc',
      pageUrl: 'https://site.com/lp?utm_source=meta',
    });
    expect(sanitizeAttribution('x')).toEqual({});
  });
});
