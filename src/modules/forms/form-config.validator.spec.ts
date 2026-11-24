import { BadRequestException } from '@nestjs/common';
import {
  assertPublishable,
  validateAfterSubmit,
  validateCapture,
  validateDestination,
  validateFieldsConfig,
  validateLooseObject,
  validatePresentation,
  validateSecurity,
  validateTracking,
} from './form-config.validator';

describe('presentation and tracking (F2)', () => {
  it('fills defaults and normalizes colors', () => {
    const result = validatePresentation({
      container: 'modal',
      theme: { primaryColor: '#ff0066' },
      trigger: { type: 'exit_intent' },
    });
    expect(result).toMatchObject({
      container: 'modal',
      flow: 'single',
      background: 'solid',
      theme: { primaryColor: '#FF0066', radius: 10, fontFamily: 'system' },
      trigger: { type: 'exit_intent', frequency: 'session' },
      submitLabel: 'Enviar',
    });
  });

  it.each([
    [{ container: 'popup' }, /container/],
    [{ theme: { primaryColor: 'red; background:url(x)' } }, /#RRGGBB/],
    [{ logoUrl: 'javascript:alert(1)' }, /https URL/],
    [{ logoUrl: 'http://site.com/logo.png' }, /https URL/],
    [{ maxWidth: 5000 }, /between 320 and 1200/],
  ])('rejects presentation %j', (input, message) => {
    expect(() => validatePresentation(input)).toThrow(message);
  });

  it('accepts https and API asset logos', () => {
    expect(
      validatePresentation({ logoUrl: 'https://cdn.site.com/l.png' }).logoUrl,
    ).toBe('https://cdn.site.com/l.png');
    expect(validatePresentation({ logoUrl: '/api/assets/abc' }).logoUrl).toBe(
      '/api/assets/abc',
    );
  });

  it('validates tracking ids strictly (they end up in script URLs)', () => {
    expect(
      validateTracking({
        gtmId: 'gtm-abc123',
        metaPixelId: '1234567890',
        ga4Id: 'g-ABCD1234',
        googleAdsConversionId: 'AW-123456789',
        googleAdsConversionLabel: 'AbC_d-1',
      }),
    ).toEqual({
      gtmId: 'GTM-ABC123',
      metaPixelId: '1234567890',
      ga4Id: 'G-ABCD1234',
      googleAdsConversionId: 'AW-123456789',
      googleAdsConversionLabel: 'AbC_d-1',
      fireParentEvents: true,
    });
    expect(() => validateTracking({ gtmId: "GTM-1');alert(1)//" })).toThrow(
      /invalid format/,
    );
    expect(() => validateTracking({ metaPixelId: '12ab' })).toThrow(
      /invalid format/,
    );
    expect(() =>
      validateTracking({ googleAdsConversionId: 'AW-123456789' }),
    ).toThrow(/both/);
    expect(validateTracking({ fireParentEvents: false }).fireParentEvents).toBe(
      false,
    );
  });
});

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

  it('validateDestination keeps a known card color and refuses others', () => {
    expect(validateDestination(undefined).cardColor).toBeNull();
    expect(validateDestination({ cardColor: 'amber' }).cardColor).toBe('amber');
    expect(validateDestination({ cardColor: '' }).cardColor).toBeNull();
    expect(() => validateDestination({ cardColor: '#ff0000' })).toThrow(
      /cardColor/,
    );
    expect(() => validateDestination({ cardColor: 'toString' })).toThrow(
      /cardColor/,
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

describe('validateCapture', () => {
  it('defaults, accepts mapping and rejects bad targets/selectors', () => {
    expect(validateCapture(undefined)).toEqual({
      formSelector: null,
      fieldMap: {},
    });
    expect(validateCapture({})).toEqual({ formSelector: null, fieldMap: {} });
    expect(
      validateCapture({
        formSelector: ' #contato form ',
        fieldMap: { 'your-name': 'contact.name', x: 'ignore' },
      }),
    ).toEqual({
      formSelector: '#contato form',
      fieldMap: { 'your-name': 'contact.name', x: 'ignore' },
    });
    expect(() =>
      validateCapture({ fieldMap: { a: 'contact.password' } }),
    ).toThrow();
    expect(() => validateCapture({ formSelector: '<script>' })).toThrow();
  });
});
