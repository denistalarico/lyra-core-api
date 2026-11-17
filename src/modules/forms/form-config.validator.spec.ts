import { BadRequestException } from '@nestjs/common';
import {
  assertPublishable,
  validateAfterSubmit,
  validateDestination,
  validateFieldsConfig,
  validateLooseObject,
  validateSecurity,
} from './form-config.validator';

describe('form-config.validator', () => {
  describe('validateFieldsConfig', () => {
    it('defaults email/phone targets and keeps declared options', () => {
      const result = validateFieldsConfig({
        fields: [
          {
            key: 'nome',
            label: 'Nome',
            type: 'text',
            target: 'contact.name',
            required: true,
          },
          { key: 'email', label: 'E-mail', type: 'email' },
          { key: 'fone', label: 'WhatsApp', type: 'phone' },
          {
            key: 'servico',
            label: 'Serviço',
            type: 'select',
            options: ['Site', 'Tráfego'],
          },
        ],
      });
      expect(result.fields.map((field) => field.target)).toEqual([
        'contact.name',
        'contact.email',
        'contact.phone',
        'none',
      ]);
      expect(result.fields[3].options).toEqual(['Site', 'Tráfego']);
      expect(result.fields[0].required).toBe(true);
    });

    it.each([
      [{ fields: [{ key: 'Nome', label: 'x', type: 'text' }] }, /key must be/],
      [
        {
          fields: [
            { key: 'a', label: 'x', type: 'text' },
            { key: 'a', label: 'y', type: 'text' },
          ],
        },
        /duplicated key/,
      ],
      [{ fields: [{ key: 'a', label: 'x', type: 'html' }] }, /unknown type/],
      [
        { fields: [{ key: 'a', label: 'x', type: 'select' }] },
        /options are required/,
      ],
      [
        {
          fields: [
            { key: 'a', label: 'x', type: 'email' },
            { key: 'b', label: 'y', type: 'email' },
          ],
        },
        /already mapped/,
      ],
      [
        {
          fields: [{ key: 'a', label: 'x', type: 'text', step: 2 }],
          steps: [{ title: 'Um' }],
        },
        /step out of range/,
      ],
    ])('rejects %j', (input, message) => {
      expect(() => validateFieldsConfig(input)).toThrow(message);
    });

    it('never makes a hidden field required', () => {
      const { fields } = validateFieldsConfig({
        fields: [
          { key: 'origem', label: 'Origem', type: 'hidden', required: true },
        ],
      });
      expect(fields[0].required).toBe(false);
    });
  });

  it('assertPublishable needs one visible field', () => {
    expect(() =>
      assertPublishable({ fields: [{ key: 'h', label: 'H', type: 'hidden' }] }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPublishable({ fields: [{ key: 'n', label: 'N', type: 'text' }] }),
    ).not.toThrow();
  });

  it('validateDestination applies D-F10 defaults and checks ids', () => {
    expect(validateDestination(undefined)).toMatchObject({
      target: 'agency_sales',
      duplicateWindowDays: 30,
      createContact: true,
    });
    expect(() => validateDestination({ target: 'crm' })).toThrow(/target/);
    expect(() => validateDestination({ pipelineId: 'abc' })).toThrow(/UUID/);
    expect(() => validateDestination({ duplicateWindowDays: 400 })).toThrow(
      /between 0 and 365/,
    );
  });

  it('validateSecurity normalizes domains and refuses URLs', () => {
    expect(
      validateSecurity({
        allowedOrigins: ['Site.com.br', '*.site.com.br', 'site.com.br'],
      }).allowedOrigins,
    ).toEqual(['site.com.br', '*.site.com.br']);
    expect(() =>
      validateSecurity({ allowedOrigins: ['https://site.com.br/x'] }),
    ).toThrow(/valid domain/);
  });

  it('validateAfterSubmit requires an http(s) URL for redirect', () => {
    expect(() => validateAfterSubmit({ mode: 'redirect' })).toThrow(/required/);
    expect(() =>
      validateAfterSubmit({
        mode: 'redirect',
        redirectUrl: 'javascript:alert(1)',
      }),
    ).toThrow(/http or https/);
    expect(
      validateAfterSubmit({
        mode: 'redirect',
        redirectUrl: 'https://site.com/obrigado',
      }).redirectUrl,
    ).toBe('https://site.com/obrigado');
    expect(
      validateAfterSubmit({ mode: 'message', redirectUrl: 'https://x.com' })
        .redirectUrl,
    ).toBeNull();
  });

  it('validateLooseObject caps size', () => {
    expect(() =>
      validateLooseObject({ big: 'x'.repeat(40_000) }, 'tracking'),
    ).toThrow(/too large/);
    expect(() => validateLooseObject([], 'tracking')).toThrow(/object/);
  });
});
