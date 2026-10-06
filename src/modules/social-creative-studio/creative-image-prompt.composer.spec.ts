import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CreativeGenerationBrandFacts,
  CreativeGenerationContentFacts,
} from './creative-generation-context';
import { composeCreativeImagePrompt } from './creative-image-prompt.composer';

const BRAND: CreativeGenerationBrandFacts = {
  palette: [
    { role: 'primary', hex: '#0B3D2E', label: 'Verde escuro' },
    { role: 'accent', hex: '#C9A227', label: null },
  ],
  typography: [{ role: 'heading', family: 'Montserrat' }],
  guidelines: 'Fotografia natural, luz quente.',
};

const CONTENT: CreativeGenerationContentFacts = {
  title: 'Blend de inverno',
  contentType: 'post',
  creativeFormat: 'image',
  objective: null,
  funnelStage: null,
  theme: null,
  keyMessage: 'Aconchego em cada xícara',
  brief: null,
  copy: null,
  caption: 'Chegou o blend de inverno',
  script: null,
  cta: 'Peça já',
  channels: ['instagram/feed'],
};

describe('composeCreativeImagePrompt (CS3.4.1)', () => {
  it('standalone without Brand Kit: the request plus the fixed constraints, nothing invented', () => {
    expect(
      composeCreativeImagePrompt({
        prompt: 'xícara de café numa mesa de madeira',
        aspectRatio: '1:1',
        brand: null,
        content: null,
      }),
    ).toBe(
      [
        'Social media creative image, square format (1:1).',
        '',
        "REQUEST (the operator's intent — it takes priority over everything below):",
        'xícara de café numa mesa de madeira',
        '',
        'CONSTRAINTS:',
        '- If the request conflicts with any context above, follow the request.',
        '- Do not add text, captions or lettering unless the request asks for it; reproduce any requested text exactly as written.',
        '- Do not invent logos, wordmarks, trademarks or brand names.',
      ].join('\n'),
    );
  });

  it('is deterministic and keeps the order intent → request → content → brand → constraints', () => {
    const input = {
      prompt: 'xícara na mesa',
      aspectRatio: '4:5' as const,
      brand: BRAND,
      content: CONTENT,
    };
    const prompt = composeCreativeImagePrompt(input);

    expect(composeCreativeImagePrompt({ ...input })).toBe(prompt);
    const order = [
      'Social media creative image, portrait format (4:5), for instagram/feed.',
      'REQUEST',
      'CONTENT CONTEXT',
      'BRAND IDENTITY',
      'CONSTRAINTS',
    ].map((marker) => prompt.indexOf(marker));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('renders brand as visual direction and Planner copy as quoted context', () => {
    const prompt = composeCreativeImagePrompt({
      prompt: 'xícara na mesa',
      aspectRatio: '1:1',
      brand: BRAND,
      content: CONTENT,
    });

    expect(prompt).toContain(
      '- Color palette: primary #0B3D2E (Verde escuro); accent #C9A227',
    );
    expect(prompt).toContain('- Typography: heading: Montserrat');
    expect(prompt).toContain(
      '- Brand guidelines: Fotografia natural, luz quente.',
    );
    expect(prompt).toContain('- Post caption: "Chegou o blend de inverno"');
    expect(prompt).toContain('- Call to action: "Peça já"');
    expect(prompt).toContain('do not write it into the image');
    expect(prompt).toContain(
      'Keep the overall color scheme consistent with the brand palette.',
    );
    // Without reference images there is no promise of logo fidelity.
    expect(prompt).not.toMatch(/use (the|this) (exact )?logo/i);
    // Empty fields leave no empty bullet behind.
    expect(prompt).not.toContain('Objective');
    expect(prompt).not.toContain('Script');
  });

  it('degrades an incomplete Brand Kit to what exists', () => {
    const prompt = composeCreativeImagePrompt({
      prompt: 'xícara',
      aspectRatio: '9:16',
      brand: { palette: [BRAND.palette[0]], typography: [], guidelines: null },
      content: null,
    });
    expect(prompt).toContain('Color palette');
    expect(prompt).not.toContain('Typography');
    expect(prompt).not.toContain('Brand guidelines');
    expect(prompt).not.toContain('brand typography');
  });

  it('never lets context replace the operator request', () => {
    const prompt = composeCreativeImagePrompt({
      prompt: 'um cachorro na praia',
      aspectRatio: '1:1',
      brand: BRAND,
      content: CONTENT,
    });
    expect(prompt).toContain("REQUEST (the operator's intent");
    expect(prompt).toContain('\num cachorro na praia\n');
    expect(prompt).toContain(
      'If the request conflicts with any context above, follow the request.',
    );
  });
});

describe('provider boundary (CS3.4.1)', () => {
  const source = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it.each([
    'openai-image-generation.provider.ts',
    'creative-image-generation.provider.ts',
  ])(
    '%s knows nothing of Brand Kit, Planner or the Generation Context',
    (file) => {
      const imports = source(file)
        .split('\n')
        .filter((line) => /^\s*(import|from)\b|from '/.test(line))
        .join('\n');
      for (const forbidden of [
        'brand-kit',
        'social-planner',
        'creative-brand-context',
        'creative-generation-context',
        'creative-image-prompt.composer',
        'creative-generation-references',
        'media-assets',
      ])
        expect(imports).not.toContain(forbidden);
    },
  );

  // CS3.4.2: the domain chooses WHAT to send; only the adapter knows HOW.
  it.each([
    'creative-image-generation.service.ts',
    'creative-image-generation.worker.ts',
    'creative-generation-references.ts',
    'creative-generation-context.ts',
    'creative-image-prompt.composer.ts',
  ])('%s never names an OpenAI endpoint or the adapter', (file) => {
    const text = source(file);
    expect(text).not.toMatch(
      /images\/edits|images\/generations|api\.openai\.com/,
    );
    expect(text).not.toContain("from './openai-image-generation.provider'");
  });
});

describe('composeCreativeImagePrompt — reference images (CS3.4.2)', () => {
  const base = {
    prompt: 'xícara na mesa',
    aspectRatio: '1:1' as const,
    brand: null,
    content: null,
  };

  it('numbers images in the given order with a kind-specific role, right after the request', () => {
    const text = composeCreativeImagePrompt({
      ...base,
      references: [
        { kind: 'product', role: 'subject' },
        { kind: 'logo', role: 'logo' },
        { kind: 'style', role: 'style' },
        { kind: 'environment', role: 'context' },
        { kind: 'person', role: 'subject' },
        { kind: 'client_provided', role: 'general' },
      ],
    });
    const lines = text.split('\n').filter((l) => l.startsWith('- Image '));
    expect(lines).toEqual([
      '- Image 1: the product — keep its shape, proportions, colors, materials and label as faithful as possible.',
      "- Image 2: the brand's logo — when the request calls for the brand mark, reproduce this exact logo without redrawing, restyling or recoloring it; otherwise leave it out.",
      '- Image 3: a style reference — use only its lighting, color, mood and composition; do not copy its subject or any text in it.',
      "- Image 4: a place or setting — use it as the scene's environment; angle and composition may change.",
      '- Image 5: a person — keep their appearance consistent with the photo (face, hair, skin tone, build); do not add names or identifying text.',
      '- Image 6: a reference provided by the client — use it as the request describes, assuming no other role.',
    ]);
    expect(text.indexOf('REQUEST')).toBeLessThan(
      text.indexOf('REFERENCE IMAGES'),
    );
    expect(text.indexOf('REFERENCE IMAGES')).toBeLessThan(
      text.indexOf('CONSTRAINTS'),
    );
  });

  it('a logo reference allows only that mark; without one, no marks at all', () => {
    const withLogo = composeCreativeImagePrompt({
      ...base,
      references: [{ kind: 'logo', role: 'logo' }],
    });
    expect(withLogo).toContain(
      'the only logo allowed is the one in the reference images',
    );
    const productOnly = composeCreativeImagePrompt({
      ...base,
      references: [{ kind: 'product', role: 'subject' }],
    });
    expect(productOnly).toMatch(
      /^- Do not invent logos, wordmarks, trademarks or brand names\.$/m,
    );
    expect(productOnly).not.toContain('the only logo allowed');
  });

  it('an unknown future kind falls back to its role, never to "preserve"', () => {
    const text = composeCreativeImagePrompt({
      ...base,
      references: [{ kind: 'drone_shot', role: 'general' }],
    });
    expect(text).toContain('- Image 1: a reference provided by the client');
  });

  it('no references: the text-only recipe is unchanged', () => {
    expect(composeCreativeImagePrompt({ ...base, references: [] })).toBe(
      composeCreativeImagePrompt(base),
    );
    expect(composeCreativeImagePrompt(base)).not.toContain('REFERENCE IMAGES');
  });
});
